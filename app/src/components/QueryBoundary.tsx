import { Component, type ReactNode } from "react";

type Props = {
  // De fout uit een live query, en hoe je opnieuw begint.
  fallback: (error: unknown, reset: () => void) => ReactNode;
  children: ReactNode;
};

type State = { error: unknown; failed: boolean };

// Convex gooit de fout van een query tijdens het renderen (WP16 kernvondst 2).
// Deze grens vangt hem op, zodat het scherm niet crasht en geen oude inhoud
// toont. `reset` mount de inhoud opnieuw, met een nieuw abonnement.
export class QueryBoundary extends Component<Props, State> {
  state: State = { error: null, failed: false };

  static getDerivedStateFromError(error: unknown): State {
    return { error, failed: true };
  }

  reset = () => this.setState({ error: null, failed: false });

  render() {
    if (this.state.failed) return this.props.fallback(this.state.error, this.reset);
    return this.props.children;
  }
}
