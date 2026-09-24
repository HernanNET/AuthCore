import { createAccessControl } from "better-auth/plugins/access";
import { defaultStatements } from "better-auth/plugins/admin/access";

/**
 * Administration policy (Phase 18 + Phase 25 user CRUD).
 * Endpoints not represented here remain forbidden even for an admin role.
 * Impersonation stays intentionally excluded (evaluated again later).
 */
export const authAccessControl = createAccessControl(defaultStatements);

export const authAdminRole = authAccessControl.newRole({
  user: [
    "create",
    "list",
    "get",
    "update",
    "set-role",
    "ban",
    "delete",
    "set-password",
  ],
  session: ["list", "revoke", "delete"],
});

export const authUserRole = authAccessControl.newRole({
  user: [],
  session: [],
});

/**
 * Phase 24: sellers authenticate in AuthCore but are authorized by the consuming
 * application, so the role carries no AuthCore-side permission at all.
 */
export const authSellerRole = authAccessControl.newRole({
  user: [],
  session: [],
});

export const authRoles = {
  admin: authAdminRole,
  seller: authSellerRole,
  user: authUserRole,
};
