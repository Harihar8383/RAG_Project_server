import { clerkClient } from "@clerk/express";

/** Reads the primary email address of a Clerk user, so the local user record holds the real address. */
export function createClerkIdentity() {
  return {
    async getEmail(userId) {
      const user = await clerkClient.users.getUser(userId);
      const primary = user.emailAddresses.find((e) => e.id === user.primaryEmailAddressId) || user.emailAddresses[0];
      return primary?.emailAddress;
    },
  };
}
