import { useState } from 'react';
import type { Project } from '../../../../shared/types.ts';
import { Workspace, SpendChip, useUsage } from '../Athena.tsx';

export function ProjectCopilot({ project }: { project: Project }) {
  const { usage, refresh } = useUsage();
  const [open, setOpen] = useState<string | null>(null);
  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <small className="sub">Conversations here are about {project.name}.</small><SpendChip usage={usage} />
      </div>
      <Workspace projectId={project.id} openId={open} onOpen={(to) => setOpen(to)} usage={usage} refreshUsage={refresh} />
    </>
  );
}
