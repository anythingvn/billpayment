import { Component, type ComponentChildren } from 'preact';

interface State {
  error: Error | null;
}

/** Shows a recovery message instead of a blank page when a screen throws. */
export class ErrorBoundary extends Component<{ children: ComponentChildren }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error(error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div class="errors">
        <b>Something went wrong on this screen.</b>
        <p>{String(this.state.error.message || this.state.error)}</p>
        <p>Your saved data is not affected. Go back to Bills, or reload the page.</p>
      </div>
    );
  }
}
