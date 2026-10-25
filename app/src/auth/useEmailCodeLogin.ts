import { useSignIn } from "@clerk/expo";
import { useCallback, useRef, useState } from "react";
import { normalizeLoginCode } from "../lib/loginCode";
import {
  emailStepResult,
  isUnknownAccountError,
  LOGIN_MESSAGES,
  loginErrorMessage,
} from "../lib/loginErrors";

// Inloggen met e-mailadres + eenmalige code uit de mail (WP13 invariant 18).
//
// `submitCode` neemt ruwe tekst en hangt niet aan het invoerveld: een code uit
// een andere bron (later de mail-link, WP22) kan hier ook in (invariant 19).

export type LoginStep =
  | { step: "email" }
  | { step: "code"; email: string };

// Welke actie een melding opleverde. Het scherm zet de melding direct onder
// die actie.
export type LoginAction = "send" | "verify" | "resend" | "changeEmail";

export type LoginFeedback = {
  action: LoginAction;
  kind: "error" | "info";
  text: string;
};

export type EmailCodeLogin = {
  step: LoginStep;
  busy: boolean;
  feedback: LoginFeedback | null;
  sendCode: (email: string) => Promise<void>;
  submitCode: (rawCode: string) => Promise<void>;
  resendCode: () => Promise<void>;
  changeEmail: () => Promise<void>;
};

const RESENT_INFO = "Er is een nieuwe code onderweg. Alleen de nieuwste code werkt.";
const CODE_FORMAT_ERROR = "Een code bestaat uit 6 cijfers.";
const EMPTY_EMAIL_ERROR = "Vul je e-mailadres in.";
const UNFINISHED_ERROR =
  "Inloggen vraagt nog een extra stap die deze app niet ondersteunt. Neem contact op met de beheerder.";

export function useEmailCodeLogin(): EmailCodeLogin {
  const { signIn } = useSignIn();

  // Naar Mail en terug (invariant 20): overleeft de app dat niet, dan staat de
  // lopende poging nog bij Clerk. Daar pakken we hem weer op, zonder een
  // nieuwe code aan te vragen.
  const [step, setStep] = useState<LoginStep>(() =>
    signIn.status === "needs_first_factor" && signIn.identifier
      ? { step: "code", email: signIn.identifier }
      : { step: "email" },
  );
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<LoginFeedback | null>(null);

  // Clerk kende het adres niet (alleen zichtbaar als Clerks eigen
  // enumeratie-bescherming uit staat). De user ziet hetzelfde als bij een
  // bekend adres; Clerk krijgt geen codes voor een poging die niet bestaat.
  const unknownAccount = useRef(false);

  // Een tweede tik terwijl de eerste loopt doet niets. Bij "stuur code" zou
  // een tweede verzoek de eerste code ongeldig maken.
  const inFlight = useRef(false);
  const run = useCallback(
    async (
      action: LoginAction,
      body: (report: {
        fail: (text: string) => void;
        note: (text: string) => void;
      }) => Promise<void>,
    ) => {
      if (inFlight.current) return;
      inFlight.current = true;
      setBusy(true);
      setFeedback(null);
      const fail = (text: string) => setFeedback({ action, kind: "error", text });
      const note = (text: string) => setFeedback({ action, kind: "info", text });
      try {
        await body({ fail, note });
      } catch (e) {
        fail(loginErrorMessage(e));
      } finally {
        inFlight.current = false;
        setBusy(false);
      }
    },
    [],
  );

  const sendCode = useCallback(
    (rawEmail: string) =>
      run("send", async ({ fail }) => {
        const email = rawEmail.trim();
        if (email === "") {
          fail(EMPTY_EMAIL_ERROR);
          return;
        }
        const { error: clerkError } = await signIn.emailCode.sendCode({
          emailAddress: email,
        });
        const result = emailStepResult(clerkError ?? undefined);
        if (result.kind === "error") {
          fail(result.message);
          return;
        }
        unknownAccount.current = isUnknownAccountError(clerkError);
        setStep({ step: "code", email });
      }),
    [run, signIn],
  );

  const submitCode = useCallback(
    (rawCode: string) =>
      run("verify", async ({ fail }) => {
        const code = normalizeLoginCode(rawCode);
        if (code === null) {
          fail(CODE_FORMAT_ERROR);
          return;
        }
        if (unknownAccount.current) {
          fail(LOGIN_MESSAGES.wrongCode);
          return;
        }
        const verified = await signIn.emailCode.verifyCode({ code });
        if (verified.error) {
          fail(loginErrorMessage(verified.error));
          return;
        }
        // Na een juiste code kan Clerk nog een stap vragen (bv. een tweede
        // factor). Dat is een zichtbare melding, geen stille hang.
        if (signIn.status !== "complete") {
          fail(UNFINISHED_ERROR);
          return;
        }
        const finalized = await signIn.finalize();
        if (finalized.error) fail(loginErrorMessage(finalized.error));
      }),
    [run, signIn],
  );

  const resendCode = useCallback(
    () =>
      run("resend", async ({ fail, note }) => {
        if (!unknownAccount.current) {
          const { error: clerkError } = await signIn.emailCode.sendCode();
          if (clerkError) {
            fail(loginErrorMessage(clerkError));
            return;
          }
        }
        note(RESENT_INFO);
      }),
    [run, signIn],
  );

  const changeEmail = useCallback(
    () =>
      run("changeEmail", async () => {
        unknownAccount.current = false;
        await signIn.reset();
        setStep({ step: "email" });
      }),
    [run, signIn],
  );

  return { step, busy, feedback, sendCode, submitCode, resendCode, changeEmail };
}
