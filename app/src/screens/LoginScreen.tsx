import { useState } from "react";
import { KeyboardAvoidingView, Text, TextInput } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useEmailCodeLogin } from "../auth/useEmailCodeLogin";
import { Button } from "../components/Button";
import { LinkButton } from "../components/LinkButton";
import { ui } from "../ui";

// Twee stappen: e-mailadres → code uit de mail. Geen wachtwoord (invariant 18)
// en niets vooringevuld (invariant 15).
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
            <LinkButton
              title="Stuur een nieuwe code"
              onPress={() => {
                setCode("");
                void login.resendCode();
              }}
              disabled={login.busy}
            />
            <LinkButton
              title="Ander e-mailadres"
              onPress={() => {
                setCode("");
                void login.changeEmail();
              }}
              disabled={login.busy}
            />
          </>
        )}

        {login.error && <Text style={ui.error}>{login.error}</Text>}
        {login.info && <Text style={ui.info}>{login.info}</Text>}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
