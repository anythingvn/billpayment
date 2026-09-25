import { render, screen } from '@testing-library/preact';
import { ErrorBoundary } from '../../src/ui/ErrorBoundary';

function Boom(): never {
  throw new Error('kaboom');
}

describe('ErrorBoundary', () => {
  it('shows a recovery message instead of a blank page', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(<ErrorBoundary><Boom /></ErrorBoundary>);
    expect(screen.getByText(/Something went wrong/)).toBeTruthy();
    expect(screen.getByText(/kaboom/)).toBeTruthy();
    spy.mockRestore();
  });
});
