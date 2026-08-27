import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import EmployerFindings from '@/pages/compliance/employers/EmployerFindings';

describe('findings render', () => {
  it('renders', () => {
    const r = render(<MemoryRouter><EmployerFindings /></MemoryRouter>);
    expect(r.container.textContent).toBeTruthy();
  });
});
