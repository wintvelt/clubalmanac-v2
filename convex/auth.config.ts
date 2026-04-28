// Clerk JWT integratie. domain = Clerk Issuer URL (frontend API).
// applicationID = naam van de Clerk JWT template (default "convex").
export default {
  providers: [
    {
      domain: "https://picked-quail-97.clerk.accounts.dev",
      applicationID: "convex",
    },
  ],
};
