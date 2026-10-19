#!/usr/bin/env bash
# Erzeugt NUR FÜR TESTS eine eigene Zertifizierungsstelle und ein Server-Zertifikat.
# Aufruf: ./make-test-certs.sh <IP-oder-Hostname-des-Servers>
# Die Datei certs/ca.crt kommt später in die App (Pinning). certs/ca.key danach sicher aufbewahren oder löschen.
set -euo pipefail
HOST="${1:?Beispiel: ./make-test-certs.sh 192.168.50.20}"
cd "$(dirname "$0")"; mkdir -p certs; cd certs
umask 077
openssl ecparam -name prime256v1 -genkey -noout -out ca.key
openssl req -x509 -new -key ca.key -sha256 -days 365 -subj "/CN=AzuNavi Test-CA" -out ca.crt \
  -addext "basicConstraints=critical,CA:TRUE,pathlen:0" -addext "keyUsage=critical,keyCertSign,cRLSign"
openssl ecparam -name prime256v1 -genkey -noout -out server.key
if [[ "$HOST" =~ ^[0-9.]+$ ]]; then SAN="IP:$HOST"; else SAN="DNS:$HOST"; fi
openssl req -new -key server.key -subj "/CN=$HOST" -out server.csr
printf "subjectAltName=%s\nbasicConstraints=CA:FALSE\nkeyUsage=digitalSignature\nextendedKeyUsage=serverAuth\n" "$SAN" > ext.cnf
openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial -days 90 -sha256 -extfile ext.cnf -out server.crt
rm -f server.csr ext.cnf ca.srl
chmod 644 ca.crt server.crt; chmod 640 server.key
openssl verify -CAfile ca.crt server.crt
echo "Fertig. Server-Zertifikat gilt 90 Tage, CA 365 Tage."
