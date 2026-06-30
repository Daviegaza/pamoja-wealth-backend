import { ROLE_PERMISSIONS, Role, Permission } from "../../../src/types/index.js";

describe("Permissions Matrix", () => {
  it("owner has all 9 permissions", () => {
    expect(ROLE_PERMISSIONS.owner).toHaveLength(9);
  });

  it("admin has all 9 permissions", () => {
    expect(ROLE_PERMISSIONS.admin).toHaveLength(9);
  });

  it("chairperson has 6 permissions", () => {
    expect(ROLE_PERMISSIONS.chairperson).toContain("view_dashboard");
    expect(ROLE_PERMISSIONS.chairperson).toContain("manage_members");
    expect(ROLE_PERMISSIONS.chairperson).not.toContain("manage_treasury");
  });

  it("treasurer can manage treasury but not manage members", () => {
    expect(ROLE_PERMISSIONS.treasurer).toContain("manage_treasury");
    expect(ROLE_PERMISSIONS.treasurer).not.toContain("manage_members");
  });

  it("secretary can create meetings and manage votes", () => {
    expect(ROLE_PERMISSIONS.secretary).toContain("create_meetings");
    expect(ROLE_PERMISSIONS.secretary).toContain("manage_votes");
  });

  it("member only has view_dashboard", () => {
    expect(ROLE_PERMISSIONS.member).toEqual(["view_dashboard"]);
  });
});
