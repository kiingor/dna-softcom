// QA isolado: componentes de produção com hooks sintéticos e nenhuma sessão real.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { ObjetivosSheet } from '../../src/modules/feedback/components/ObjetivosSheet';
import { Button } from '../../src/components/ui/button';
import '../../src/index.css';
function Preview() {
  const [open, setOpen] = useState(true);
  const [dark, setDark] = useState(false);
  return <MemoryRouter><main className="p-6 space-y-4"><h1 className="page-title">QA sintético · origem do painel</h1><p>Dados locais em hooks. Sem API, produção ou login real.</p><Button onClick={() => setOpen(true)}>Abrir feedbacks</Button><Button variant="outline" onClick={() => { document.documentElement.classList.toggle('dark', !dark); setDark(!dark); }}>Alternar tema</Button><ObjetivosSheet colaborador={open ? { id: 20, nome: 'Pessoa sintética', feedbacks: 4, dataUltimoFeedback: '2026-10-28', status: 'Em dia' } : null} guardiao={null} perms={{ canCreate: false, canEdit: false, canDelete: false }} onOpenChange={setOpen} /></main></MemoryRouter>;
}
createRoot(document.getElementById('root')!).render(<Preview />);
