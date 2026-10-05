#!/bin/bash
# สร้าง DB ทดสอบใหม่ แล้วรัน stub + migrations ทั้งหมดตามลำดับ
set -e
DB=${DB:-fwv_test}
cd "$(dirname "$0")/.."
su postgres -c "dropdb --if-exists $DB" >/dev/null
su postgres -c "createdb $DB"
P="su postgres -c"
run() { su postgres -c "psql -X -q -v ON_ERROR_STOP=1 -d $DB -f '$1'" ; }
cp tests/00_supabase_stub.sql /tmp/fwv_stub.sql; chmod 644 /tmp/fwv_stub.sql
su postgres -c "psql -X -q -v ON_ERROR_STOP=1 -d $DB -c 'CREATE SCHEMA IF NOT EXISTS extensions'"
run /tmp/fwv_stub.sql
for f in supabase/migrations/*.sql; do
  cp "$f" /tmp/fwv_mig.sql; chmod 644 /tmp/fwv_mig.sql
  echo "== $f"; run /tmp/fwv_mig.sql
done
echo "MIGRATIONS OK"
if [ "${1:-}" = "--scenario" ]; then
  cp tests/10_scenario.sql /tmp/fwv_scn.sql; chmod 644 /tmp/fwv_scn.sql
  su postgres -c "psql -X -v ON_ERROR_STOP=1 -d $DB -f /tmp/fwv_scn.sql"
fi
