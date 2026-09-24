# VOIDSTRIKE — libvoidstrike (Protocol v1 reference core)
CC      ?= gcc
CFLAGS  ?= -std=c99 -Wall -Wextra -Werror -O2
INCLUDES := -Iinclude
BUILD   := build

OBJS := $(BUILD)/rng.o $(BUILD)/checksum.o $(BUILD)/world.o

.PHONY: all test golden clean

all: $(BUILD)/libvoidstrike.a $(BUILD)/libvoidstrike.so

$(BUILD):
	mkdir -p $(BUILD)

$(BUILD)/rng.o: src/rng.c include/voidstrike/rng.h | $(BUILD)
	$(CC) $(CFLAGS) $(INCLUDES) -c $< -o $@

$(BUILD)/checksum.o: src/checksum.c include/voidstrike/checksum.h include/voidstrike/types.h | $(BUILD)
	$(CC) $(CFLAGS) $(INCLUDES) -c $< -o $@

$(BUILD)/world.o: src/world.c include/voidstrike/world.h include/voidstrike/types.h include/voidstrike/rng.h include/voidstrike/checksum.h | $(BUILD)
	$(CC) $(CFLAGS) $(INCLUDES) -c $< -o $@

$(BUILD)/libvoidstrike.a: $(OBJS)
	ar rcs $@ $^

$(BUILD)/libvoidstrike.so: $(OBJS)
	$(CC) -shared -o $@ $^

$(BUILD)/test_main: tests/test_main.c $(OBJS)
	$(CC) $(CFLAGS) $(INCLUDES) tests/test_main.c $(OBJS) -o $@ -lm

$(BUILD)/gen_golden: scripts/gen_golden.c $(OBJS)
	$(CC) $(CFLAGS) $(INCLUDES) scripts/gen_golden.c $(OBJS) -o $@ -lm

test: all $(BUILD)/test_main
	$(BUILD)/test_main

golden: all $(BUILD)/gen_golden
	mkdir -p ../../testdata/golden
	$(BUILD)/gen_golden > ../../testdata/golden/ticks.json
	@echo "golden vectors written to testdata/golden/ticks.json"

clean:
	rm -rf $(BUILD)
