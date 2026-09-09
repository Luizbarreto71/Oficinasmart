import { Button } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Field';
import { LogoMark } from '@/components/layout/LogoMark';
import { useAuth } from '@/contexts/AuthContext';
import { useState } from 'react';

export function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(false);

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    setErro('');
    setCarregando(true);
    try {
      await login(email, password);
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Não foi possível entrar.');
    } finally {
      setCarregando(false);
    }
  };

  return (
    <div className="flex min-h-full items-center justify-center bg-slate-100 p-4 dark:bg-navy-950">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <LogoMark className="h-16 w-16 text-navy-900 dark:text-slate-100" />
          <div className="leading-none">
            <p className="text-xs font-light uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Oficina do
            </p>
            <h1 className="text-xl font-extrabold uppercase text-navy-900 dark:text-slate-100">Smartphone</h1>
            <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.25em] text-slate-400">Estância</p>
          </div>
        </div>

        <form onSubmit={enviar} className="card space-y-4 p-6">
          <Field label="E-mail">
            <Input
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
            />
          </Field>
          <Field label="Senha">
            <Input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </Field>

          {erro && (
            <p className="rounded-lg bg-danger-bg px-3 py-2 text-sm font-medium text-danger dark:bg-danger/15">
              {erro}
            </p>
          )}

          <Button type="submit" className="w-full" size="lg" loading={carregando}>
            Entrar
          </Button>
        </form>

        <p className="mt-4 text-center text-xs text-slate-400">
          Sem acesso? Peça ao administrador para criar seu usuário.
        </p>
      </div>
    </div>
  );
}