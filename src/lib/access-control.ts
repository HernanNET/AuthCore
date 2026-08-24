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

export const authRoles = {
  admin: authAdminRole,
  user: authUserRole,
};
