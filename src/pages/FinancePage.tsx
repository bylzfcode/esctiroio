import { Wallet } from 'lucide-react';
import { Route, Routes } from 'react-router-dom';
import { AccountDetail } from '@/components/finance/AccountDetail';
import { FinanceHome } from '@/components/finance/FinanceHome';
import { Card } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState } from '@/components/ui/StateViews';
import { services } from '@/services';

/** Financeiro: contas a pagar/receber por loja, liquidações e comprovantes (somente com backend real). */
export default function FinancePage() {
  if (!services.finance) {
    // Modo demonstração: o financeiro NÃO é simulado.
    return (
      <>
        <PageHeader title="Financeiro" />
        <Card>
          <EmptyState icon={Wallet} title="Financeiro indisponível na demonstração">
            Contas, liquidações e comprovantes dependem do backend real (banco de dados, autorização no servidor e armazenamento
            privado). Este modo mostra apenas dados fictícios de acessos e não simula o financeiro.
          </EmptyState>
        </Card>
      </>
    );
  }
  return (
    <Routes>
      <Route index element={<FinanceHome />} />
      <Route path=":accountId" element={<AccountDetail />} />
    </Routes>
  );
}
