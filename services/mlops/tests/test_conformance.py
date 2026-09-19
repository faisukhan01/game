"""Conformance tests: RNG/checksum known-answers + golden vectors."""

from __future__ import annotations

import json
import os

import pytest

from botlab.rules import Rng, World, fnv1a64, quantize, rules_hash


def test_rng_known_answers() -> None:
    # Reference values computed with independent bignum arithmetic.
    r = Rng(0)
    assert r.next() == 0xE220A824FB499AC9
    assert r.next() == 0x6E789E67B25B946F
    assert r.next() == 0x06C45D18550A5C6F
    r = Rng(1337)
    assert r.next() == 0xB6A8A9A4AB8EC520
    assert r.next() == 0xCB7F28539ECD5C02
    assert r.next() == 0x3440FCC9B4964B23


def test_fnv_vectors() -> None:
    assert fnv1a64(b"") == 0xCBF29CE484222325
    assert fnv1a64(b"a") == 0xAF63DC4C8601EC8C
    assert fnv1a64(b"foobar") == 0x85944171F73967E8
    assert rules_hash() == 0xBFB4742570DAA8FB


def test_quantize_semantics() -> None:
    assert quantize(1.2345) == 1235
    assert quantize(-1.2345) == -1234
    assert quantize(0.0) == 0


def _scripted_input(w: World):
    from botlab.rules import Input

    waypoints = [(400, 250), (1200, 250), (1200, 650), (400, 650)]
    p = w.units[w.player_idx]
    inp = Input()

    tx, ty = waypoints[(w.tick_n // 120) % 4]
    dx, dy = tx - p.x, ty - p.y
    dl = (dx * dx + dy * dy) ** 0.5
    if dl >= 20.0:
        inp.move_x, inp.move_y = dx / dl, dy / dl

    near = None
    nd = 0.0
    bots210 = 0
    for u in w.units[1:]:
        if u.kind != 1 or not u.alive:
            continue
        d = ((u.x - p.x) ** 2 + (u.y - p.y) ** 2) ** 0.5
        if near is None or d < nd:
            near, nd = u, d
        if d <= 210.0:
            bots210 += 1
    if near is not None:
        inp.aim_x = (near.x - p.x) / nd
        inp.aim_y = (near.y - p.y) / nd
        inp.fire = True
        if nd < 150.0 and p.dash_cd <= 0.0:
            inp.dash = True
            inp.move_x = -(near.x - p.x) / nd
            inp.move_y = -(near.y - p.y) / nd
    else:
        inp.aim_x, inp.aim_y = 1.0, 0.0
    if bots210 >= 2 and p.energy >= 55.0:
        inp.nova = True
    return inp


def test_sim_determinism() -> None:
    def run(seed: int) -> list[int]:
        w = World(seed)
        out = []
        for t in range(1, 601):
            w.tick(_scripted_input(w))
            if t % 60 == 0:
                out.append(w.checksum())
        return out

    assert run(1337) == run(1337)
    assert run(1337) != run(424242)


def test_golden_vectors() -> None:
    path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(
        os.path.dirname(os.path.abspath(__file__))))), "testdata", "golden", "ticks.json")
    if not os.path.exists(path):
        pytest.skip("golden vectors not generated yet — run `make -C core/c golden`")
    with open(path, encoding="utf-8") as f:
        gf = json.load(f)
    assert gf["rules_hash"] == f"0x{rules_hash():016x}"
    for case in gf["cases"]:
        w = World(case["seed"])
        checksums = {c["tick"]: int(c["checksum"], 16) for c in case["checksums"]}
        for t in range(1, case["ticks"] + 1):
            w.tick(_scripted_input(w))
            if t in checksums:
                assert w.checksum() == checksums[t], f"seed {case['seed']} tick {t} mismatch"


def test_wave_progression() -> None:
    w = World(1337)
    for _ in range(3600):
        w.tick(_scripted_input(w))
    assert w.wave >= 3
    assert w.score > 0
