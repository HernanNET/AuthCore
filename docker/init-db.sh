#!/bin/bash
set -e

# Create the dedicated test database alongside the development database.
# Both are owned by the POSTGRES_USER so the same credentials work for dev + test.
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
  CREATE DATABASE authcore_test;
EOSQL
