import { Pool } from "pg";

const pool = new Pool({
  connectionString:
    "postgres://authcore:authcore_dev@localhost:5432/authcore_dev",
});

const tables = ["user", "account", "session", "verification"];

for (const t of tables) {
  const { rows } = await pool.query(
    "SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position",
    [t],
  );
  console.log(`=== ${t} ===`);
  for (const r of rows) {
    console.log(`  ${r.column_name} | ${r.data_type} | nullable=${r.is_nullable}`);
  }
}
await pool.end();
