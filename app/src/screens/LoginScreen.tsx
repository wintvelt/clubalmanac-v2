import { useState } from "react";
import { Image, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTokenWipeFailed, wipeStoredTokens } from "../auth/tokenCache";
import {
  useEmailCodeLogin,
  type LoginAction,
  type LoginFeedback,
} from "../auth/useEmailCodeLogin";
import { Button } from "../components/Button";
import { Gradient } from "../components/Gradient";
import { LinkButton } from "../components/LinkButton";
import { Notice } from "../components/Notice";
import { Screen } from "../components/Screen";
import { Text } from "../components/Text";
import { TextField } from "../components/TextField";
import { size, space, useTheme } from "../theme";

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
    <Screen background="surface" header={<WashHeader />}>
      <Text variant="largeTitle" accessibilityRole="header">
        Clubalmanac
      </Text>

      <TokenWipeNotice />

      {login.step.step === "email" ? (
        <>
          <Text color="muted">Log in met je e-mailadres. We sturen je een code.</Text>
          <TextField
            label="E-mailadres"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            textContentType="emailAddress"
            autoComplete="email"
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="send"
            onSubmitEditing={() => login.sendCode(email)}
            editable={!login.busy}
          />
          <Button
            title="Stuur code"
            busyTitle="Code versturen…"
            onPress={() => login.sendCode(email)}
            busy={login.busy}
          />
          <Feedback feedback={login.feedback} action="send" />
        </>
      ) : (
        <>
          <Text color="muted">
            Als {login.step.email} bij ons bekend is, krijg je een mail met een code van 6
            cijfers. Komt er niets, controleer dan het adres.
          </Text>
          <TextField
            label="Code"
            value={code}
            onChangeText={setCode}
            keyboardType="number-pad"
            textContentType="oneTimeCode"
            autoComplete="one-time-code"
            returnKeyType="done"
            onSubmitEditing={() => login.submitCode(code)}
            editable={!login.busy}
          />
          <Button
            title="Log in"
            busyTitle="Inloggen…"
            onPress={() => login.submitCode(code)}
            busy={login.busy}
          />
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
    </Screen>
  );
}

// Zachte tint achter het app-icoon, tot onder de statusbalk.
function WashHeader() {
  const { colors, scheme } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.wash, { paddingTop: insets.top + space.l }]}>
      <Gradient from={colors.washStart} to={colors.washEnd} />
      <View style={styles.washColumn}>
        <Image
          source={
            scheme === "dark"
              ? require("../../assets/icon/icon-dark.png")
              : require("../../assets/icon/icon-light.png")
          }
          style={styles.appIcon}
          accessibilityIgnoresInvertColors
          accessible={false}
        />
      </View>
    </View>
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
  return <Notice kind={feedback.kind === "error" ? "error" : "success"} message={feedback.text} />;
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
      <Notice
        kind="error"
        message="Je bent uitgelogd, maar je inloggegevens konden niet van dit toestel worden gewist."
      />
      <LinkButton
        title="Opnieuw wissen"
        tone="action"
        onPress={() => {
          setRetryFailed(false);
          void wipeStoredTokens().then((ok) => setRetryFailed(!ok));
        }}
      />
      {retryFailed && <Notice kind="error" message="Wissen lukt nog steeds niet." />}
    </>
  );
}

const ICON = 92;

const styles = StyleSheet.create({
  wash: { paddingBottom: space.xl },
  washColumn: {
    width: "100%",
    maxWidth: size.maxTextColumn,
    alignSelf: "center",
    paddingHorizontal: size.screenMargin,
  },
  appIcon: { width: ICON, height: ICON, borderRadius: ICON * 0.225 },
});
