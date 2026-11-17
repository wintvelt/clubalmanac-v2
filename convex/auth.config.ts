// Clerk JWT integratie. domain = Clerk Issuer URL (frontend API), per
// deployment uit de env-var: dev Convex praat met dev Clerk, prod met prod.
// Ontbreekt de variabele, dan weigert `npx convex deploy`.
// applicationID = naam van de Clerk JWT template (default "convex").
export default {
  providers: [
    {
      domain: process.env.CLERK_FRONTEND_API_URL,
      applicationID: "convex",
    },
  ],
};
