#!/bin/sh
# Database-per-service: one database and one login role per service. Each role owns
# only its own database and CONNECT is revoked from PUBLIC, so a service physically
# cannot read another service's data.
set -eu

: "${SERVICE_DB_PASSWORD:?SERVICE_DB_PASSWORD must be set}"
DATABASES="auth users expenses incomes categories budgets recurring goals analytics notifications reports search currency audit ai files"

for db in $DATABASES; do
  role="${db}_svc"
  echo "Creating database ${db} owned by ${role}"
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<SQL
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${role}') THEN
    CREATE ROLE ${role} LOGIN PASSWORD '${SERVICE_DB_PASSWORD}' CONNECTION LIMIT 40;
  END IF;
END \$\$;
SELECT 'CREATE DATABASE ${db} OWNER ${role}' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '${db}')\gexec
REVOKE ALL ON DATABASE ${db} FROM PUBLIC;
GRANT CONNECT, TEMPORARY ON DATABASE ${db} TO ${role};
SQL
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$db" <<SQL
REVOKE ALL ON SCHEMA public FROM PUBLIC;
ALTER SCHEMA public OWNER TO ${role};
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
SQL
done
