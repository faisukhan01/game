FROM python:3.12-slim
WORKDIR /app
RUN useradd -m striker
COPY pyproject.toml ./
COPY botlab ./botlab
RUN pip install --no-cache-dir . && chown -R striker:striker /app
USER striker
ENTRYPOINT ["botlab"]
