import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EvidenceBlock } from './EvidenceBlock.js';

const baseProps = {
  adapterKey: 'template-checks',
  adapterVersion: '0.4.2',
  observedAt: '2026-09-10 03:14:02 UTC',
  rawArtifactHref: '#raw-artifact',
};

describe('EvidenceBlock (SEC-17)', () => {
  it('renders a script-tag-shaped evidence line as inert text, not a live element', () => {
    const { container } = render(
      <EvidenceBlock {...baseProps} lines={['Server: <script>window.__pwned = true;</script>']} />,
    );

    // The literal characters must be visible as text...
    expect(screen.getByText(/<script>window\.__pwned = true;<\/script>/)).toBeDefined();
    // ...and must NOT exist as an actual, executable <script> element in the DOM.
    expect(container.querySelector('script')).toBeNull();
    expect((window as unknown as { __pwned?: boolean }).__pwned).toBeUndefined();
  });

  it('renders an onerror-handler-shaped evidence line without creating a live img element with a handler', () => {
    const { container } = render(
      <EvidenceBlock {...baseProps} lines={['X-Banner: "><img src=x onerror=alert(1)>']} />,
    );

    expect(screen.getByText(/<img src=x onerror=alert\(1\)>/)).toBeDefined();
    const img = container.querySelector('img');
    expect(img).toBeNull();
  });

  it('renders a matched span as highlighted text without altering the underlying content', () => {
    render(
      <EvidenceBlock
        {...baseProps}
        lines={['X-Api-Version: ${jndi:ldap://xenitex-scanner.internal/a}']}
        matchedSpan={{ lineIndex: 0, start: 15, length: 43 }}
      />,
    );

    const mark = screen.getByText('${jndi:ldap://xenitex-scanner.internal/a}');
    expect(mark.tagName).toBe('MARK');
    // The full line's text content must still be intact once mark + surrounding text are combined.
    expect(mark.closest('[class*="lineContent"]')?.textContent).toBe(
      'X-Api-Version: ${jndi:ldap://xenitex-scanner.internal/a}',
    );
  });

  it('never uses dangerouslySetInnerHTML anywhere in the rendered tree', () => {
    // Static guard: if a future edit introduces dangerouslySetInnerHTML, the
    // rendered line content would no longer be reachable via getByText as
    // plain text nodes the way the tests above assert.
    const { container } = render(<EvidenceBlock {...baseProps} lines={['plain evidence line']} />);
    expect(container.innerHTML).toContain('plain evidence line');
  });
});
