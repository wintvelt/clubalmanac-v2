import { useState } from "react";
import { KeyboardAvoidingView, Text, TextInput } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTokenWipeFailed, wipeStoredTokens } from "../auth/tokenCache";
import {
  useEmailCodeLogin,
  type LoginAction,
  type LoginFeedback,
} from "../auth/useEmailCodeLogin";
import { Button } from "../components/Button";
import { LinkButton } from "../components/LinkButton";
import { ui } from "../ui";

// Twee stappen: e-mailadres → code uit de mail. Geen wachtwoord (invariant 18)
// en niets vooringevuld (invariant 15). Elke melding staat direct onder de
// actie die hem opleverde.
export function LoginScreen() {
  const login = useEmailCodeLogin();
  const [email, setEmail] = useState(
    login.step.step === "code" ? login.step.email : "",
  );
  const [code, setCode] = useState("");

  return (
    <SafeAreaView style={ui.screen}>
      <KeyboardAvoidingView behavior="padding" style={ui.centered}>
        <Text style={ui.title}>Clubalmanac</Text>

        <TokenWipeNotice />

        {login.step.step === "email" ? (
          <>
            <Text style={ui.text}>Log in met je e-mailadres. We sturen je een code.</Text>
            <TextInput
              style={ui.input}
              value={email}
              onChangeText={setEmail}
              placeholder="E-mailadres"
              keyboardType="email-address"
              textContentType="emailAddress"
              autoComplete="email"
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="send"
              onSubmitEditing={() => login.sendCode(email)}
              editable={!login.busy}
            />
            <Button title="Stuur code" onPress={() => login.sendCode(email)} busy={login.busy} />
            <Feedback feedback={login.feedback} action="send" />
          </>
        ) : (
          <>
            <Text style={ui.text}>
              Als {login.step.email} bij ons bekend is, krijg je een mail met een code van 6
              cijfers. Komt er niets, controleer dan het adres.
            </Text>
            <TextInput
              style={ui.input}
              value={code}
              onChangeText={setCode}
              placeholder="Code"
              keyboardType="number-pad"
              textContentType="oneTimeCode"
              autoComplete="one-time-code"
              returnKeyType="done"
              onSubmitEditing={() => login.submitCode(code)}
              editable={!login.busy}
            />
            <Button title="Log in" onPress={() => login.submitCode(code)} busy={login.busy} />
            <Feedback feedback={login.feedback} action="verify" />
            <LinkButton
              title="Stuur een nieuwe code"
              onPress={() => {
                setCode("");
                void login.resendCode();
              }}
              disabled={login.busy}
            />
            <Feedback feedback={login.feedback} action="resend" />
            <LinkButton
              title="Ander e-mailadres"
              onPress={() => {
                setCode("");
                void login.changeEmail();
              }}
              disabled={login.busy}
            />
            <Feedback feedback={login.feedback} action="changeEmail" />
          </>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Feedback({
  feedback,
  action,
}: {
  feedback: LoginFeedback | null;
  action: LoginAction;
}) {
  if (feedback?.action !== action) return null;
  return <Text style={feedback.kind === "error" ? ui.error : ui.info}>{feedback.text}</Text>;
}

// Het wissen na uitloggen mislukte (zie wipeStoredTokens). De uitlog-knop is
// dan al weg; de melding staat bovenaan, en een nieuwe poging meldt zich
// direct onder "Opnieuw wissen".
function TokenWipeNotice() {
  const wipeFailed = useTokenWipeFailed();
  const [retryFailed, setRetryFailed] = useState(false);
  if (!wipeFailed) return null;
  return (
    <>
      <Text style={ui.error}>
        Je bent uitgelogd, maar je inloggegevens konden niet van dit toestel worden gewist.
      </Text>
      <LinkButton
        title="Opnieuw wissen"
        onPress={() => {
          setRetryFailed(false);
          void wipeStoredTokens().then((ok) => setRetryFailed(!ok));
        }}
      />
      {retryFailed && <Text style={ui.error}>Wissen lukt nog steeds niet.</Text>}
    </>
  );
}
