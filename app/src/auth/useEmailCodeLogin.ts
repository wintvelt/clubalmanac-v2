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

export type EmailCodeLogin = {
  step: LoginStep;
  busy: boolean;
  error: string | null;
  info: string | null;
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
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  // Clerk kende het adres niet (alleen zichtbaar als Clerks eigen
  // enumeratie-bescherming uit staat). De user ziet hetzelfde als bij een
  // bekend adres; Clerk krijgt geen codes voor een poging die niet bestaat.
  const unknownAccount = useRef(false);

  // Een tweede tik terwijl de eerste loopt doet niets. Bij "stuur code" zou
  // een tweede verzoek de eerste code ongeldig maken.
  const inFlight = useRef(false);
  const run = useCallback(async (action: () => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await action();
    } catch (e) {
      setError(loginErrorMessage(e));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, []);

  const sendCode = useCallback(
    (rawEmail: string) =>
      run(async () => {
        const email = rawEmail.trim();
        if (email === "") {
          setError(EMPTY_EMAIL_ERROR);
          return;
        }
        const { error: clerkError } = await signIn.emailCode.sendCode({
          emailAddress: email,
        });
        const result = emailStepResult(clerkError ?? undefined);
        if (result.kind === "error") {
          setError(result.message);
          return;
        }
        unknownAccount.current = isUnknownAccountError(clerkError);
        setStep({ step: "code", email });
      }),
    [run, signIn],
  );

  const submitCode = useCallback(
    (rawCode: string) =>
      run(async () => {
        const code = normalizeLoginCode(rawCode);
        if (code === null) {
          setError(CODE_FORMAT_ERROR);
          return;
        }
        if (unknownAccount.current) {
          setError(LOGIN_MESSAGES.wrongCode);
          return;
        }
        const verified = await signIn.emailCode.verifyCode({ code });
        if (verified.error) {
          setError(loginErrorMessage(verified.error));
          return;
        }
        // Na een juiste code kan Clerk nog een stap vragen (bv. een tweede
        // factor). Dat is een zichtbare melding, geen stille hang.
        if (signIn.status !== "complete") {
          setError(UNFINISHED_ERROR);
          return;
        }
        const finalized = await signIn.finalize();
        if (finalized.error) setError(loginErrorMessage(finalized.error));
      }),
    [run, signIn],
  );

  const resendCode = useCallback(
    () =>
      run(async () => {
        if (!unknownAccount.current) {
          const { error: clerkError } = await signIn.emailCode.sendCode();
          if (clerkError) {
            setError(loginErrorMessage(clerkError));
            return;
          }
        }
        setInfo(RESENT_INFO);
      }),
    [run, signIn],
  );

  const changeEmail = useCallback(
    () =>
      run(async () => {
        unknownAccount.current = false;
        await signIn.reset();
        setStep({ step: "email" });
      }),
    [run, signIn],
  );

  return { step, busy, error, info, sendCode, submitCode, resendCode, changeEmail };
}
