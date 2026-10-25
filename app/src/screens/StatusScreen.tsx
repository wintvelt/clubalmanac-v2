import type { ReactNode } from "react";
import { Notice } from "../components/Notice";
import { Screen } from "../components/Screen";
import { LoadingState } from "../components/States";
import { Text } from "../components/Text";

type Props = {
  title?: string;
  message?: string;
  // Toont title en message als foutmelding (design.md §6).
  error?: boolean;
  spinner?: boolean;
  spinnerLabel?: string;
  children?: ReactNode;
};

export function StatusScreen({
  title,
  message,
  error = false,
  spinner = false,
  spinnerLabel,
  children,
}: Props) {
  return (
    <Screen centered>
      {error ? (
        <Notice kind="error" title={title} message={message} />
      ) : (
        <>
          {title && (
            <Text variant="largeTitle" accessibilityRole="header">
              {title}
            </Text>
          )}
          {message && <Text>{message}</Text>}
        </>
      )}
      {spinner && <LoadingState label={spinnerLabel} />}
      {children}
    </Screen>
  );
}
