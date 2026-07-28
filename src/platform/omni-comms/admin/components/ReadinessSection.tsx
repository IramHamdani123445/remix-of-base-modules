import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

interface Props {
  id: string;
  title: string;
  description?: string;
  children: React.ReactNode;
}

/**
 * Consistent readiness section wrapper. Uses a proper heading level so
 * assistive tech can navigate the Readiness page by section.
 */
export const ReadinessSection: React.FC<Props> = ({ id, title, description, children }) => (
  <Card as="section" aria-labelledby={`${id}-heading`}>
    <CardHeader>
      <CardTitle id={`${id}-heading`} className="text-base">
        {title}
      </CardTitle>
      {description ? <CardDescription>{description}</CardDescription> : null}
    </CardHeader>
    <CardContent className="text-sm">{children}</CardContent>
  </Card>
);

export default ReadinessSection;
