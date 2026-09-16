import type { Meta, StoryObj } from '@storybook/react';
import { EvidenceBlock } from './EvidenceBlock.js';

const meta: Meta<typeof EvidenceBlock> = {
  title: 'Data display/EvidenceBlock',
  component: EvidenceBlock,
};
export default meta;

type Story = StoryObj<typeof EvidenceBlock>;

// Real content per UI-01: a safe-detection probe/response pair for the
// Log4Shell issue used throughout the wireframes (CVE-2021-44228) — a
// crafted header is sent and the response is inspected for a lookup being
// triggered, never actual exploitation (ANTI-04).
export const Log4Shell: Story = {
  args: {
    adapterKey: 'template-checks',
    adapterVersion: '0.4.2',
    observedAt: '2026-09-10 03:14:02 UTC',
    rawArtifactHref: '#raw-artifact',
    matchedSpan: { lineIndex: 1, start: 16, length: 34 },
    lines: [
      'GET / HTTP/1.1',
      'X-Api-Version: ${jndi:ldap://xenitex-scanner.internal/a}',
      'Host: api-gateway-01.dmz',
      '',
      'HTTP/1.1 200 OK',
      'Server: Apache-Tomcat/9.0.41',
      'X-Powered-By: JBoss-EAP-7.3',
      'Content-Type: application/json',
      '',
      '{"status":"ok","lookupTriggered":true}',
    ],
  },
};

/**
 * SEC-17 proof-of-safety story, not a real finding: evidence content is
 * attacker-controlled by definition, so this deliberately feeds strings
 * shaped like an XSS/markup-injection attempt through the exact same prop
 * a real scanner adapter would populate. If this ever renders as anything
 * other than inert text — a real <script>/<img> tag, an executed handler —
 * that is the regression this story exists to catch visually, and
 * EvidenceBlock.test.tsx catches it programmatically in CI.
 */
export const HostileContent: Story = {
  name: 'Hostile content (SEC-17 safety check, not a real finding)',
  args: {
    adapterKey: 'template-checks',
    adapterVersion: '0.4.2',
    observedAt: '2026-09-10 03:14:02 UTC',
    rawArtifactHref: '#raw-artifact',
    lines: [
      'Server: <script>alert(document.cookie)</script>',
      'X-Banner: "><img src=x onerror=alert(1)>',
      'X-Comment: {{constructor.constructor("alert(1)")()}}',
    ],
  },
};
