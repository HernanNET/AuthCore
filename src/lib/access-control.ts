import { createAccessControl } from "better-auth/plugins/access";
import { defaultStatements } from "better-auth/plugins/admin/access";

/**
 * Phase 18 least-privilege administration policy.
 * Endpoints not represented here remain forbidden even for an admin role.
 */
export const authAccessControl = createAccessControl(defaultStatements);

export const authAdminRole = authAccessControl.newRole({
  user: ["list", "get", "ban"],
  session: ["revoke"],
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
