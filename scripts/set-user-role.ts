import { pool } from "../src/lib/database";

const [requestedRole, rawEmail] = process.argv.slice(2);
const allowedRoles = new Set(["admin", "user"]);

async function main(): Promise<void> {
  if (!allowedRoles.has(requestedRole) || !rawEmail) {
    throw new Error(
      "Usage: pnpm admin:promote -- user@example.com OR pnpm admin:demote -- user@example.com",
    );
  }

  const email = rawEmail.trim().toLowerCase();
  const { rows } = await pool.query(
    'SELECT id, email, "emailVerified", role FROM "user" WHERE email = $1',
    [email],
  );
  const user = rows[0];
  if (!user) throw new Error(`No user exists with email: ${email}`);
  if (!user.emailVerified) {
    throw new Error("Refusing to change the role of an unverified user.");
  }

  await pool.query(
    'UPDATE "user" SET role = $1, "updatedAt" = NOW() WHERE id = $2',
    [requestedRole, user.id],
  );
  console.log(`[authcore] ${email} now has role: ${requestedRole}`);
}

main()
  .catch((error) => {
    console.error("[authcore] role change failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
