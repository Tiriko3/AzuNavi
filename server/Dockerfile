# ENTWURF – nur zum Testen mit erfundenen Daten.
# Vor dem Einsatz: Basis-Images per Digest festpinnen (@sha256:...) und mit Trivy prüfen.
FROM rust:1.91-bookworm AS build
WORKDIR /src
COPY Cargo.toml Cargo.lock ./
COPY src ./src
RUN cargo build --release --locked
RUN mkdir /data && chown 65532:65532 /data

# Minimales Image: nur das Programm, keine Shell, keine Werkzeuge, läuft als „nonroot“ (65532)
FROM gcr.io/distroless/cc-debian12:nonroot
COPY --from=build /src/target/release/azunavi-server /azunavi-server
COPY --from=build --chown=65532:65532 /data /data
USER 65532:65532
ENV AZUNAVI_DB=/data/azunavi.db
ENTRYPOINT ["/azunavi-server"]
CMD ["serve", "--bind", "0.0.0.0:8080"]
