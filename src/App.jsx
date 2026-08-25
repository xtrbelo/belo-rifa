import { useState, useEffect } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { getFirestore, doc, setDoc, onSnapshot, getDoc, runTransaction } from 'firebase/firestore';
import { Ticket, Calendar, Trophy, ShoppingCart, User, Phone, CheckCircle, Lock, Settings, Search, Download, X, MessageCircle } from 'lucide-react';

// --- CONFIGURAÇÃO FIREBASE ---
const requireEnv = (value, name) => {
  if (!value) {
    throw new Error(`Variável de ambiente obrigatória ausente: ${name}`);
  }
  return value;
};

const firebaseConfig = {
  apiKey: requireEnv(import.meta.env.VITE_FIREBASE_API_KEY, 'VITE_FIREBASE_API_KEY'),
  authDomain: requireEnv(import.meta.env.VITE_FIREBASE_AUTH_DOMAIN, 'VITE_FIREBASE_AUTH_DOMAIN'),
  projectId: requireEnv(import.meta.env.VITE_FIREBASE_PROJECT_ID, 'VITE_FIREBASE_PROJECT_ID'),
  storageBucket: requireEnv(import.meta.env.VITE_FIREBASE_STORAGE_BUCKET, 'VITE_FIREBASE_STORAGE_BUCKET'),
  messagingSenderId: requireEnv(import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID, 'VITE_FIREBASE_MESSAGING_SENDER_ID'),
  appId: requireEnv(import.meta.env.VITE_FIREBASE_APP_ID, 'VITE_FIREBASE_APP_ID'),
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID
};

const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp);
const appId = 'belo-rifa-app'; // Usar o ID correto do documento no Firestore
const initialAuthToken = globalThis.__initial_auth_token;

// Constantes de Caminho (Regra 1)
const SETTINGS_PATH = ['artifacts', appId, 'public', 'data', 'raffleSettings'];
const TICKETS_PATH = ['artifacts', appId, 'public', 'data', 'raffleTickets'];
const PURCHASES_ENABLED = false;

// --- COMPONENTE PRINCIPAL ---
export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [adminError, setAdminError] = useState('');
  const [adminLoginOpen, setAdminLoginOpen] = useState(false);
  const [adminDashboardOpen, setAdminDashboardOpen] = useState(false);
  
  // Estado da Rifa
  const [config, setConfig] = useState({
    totalNumbers: 300,
    price: 20,
    drawDate: 'A definir',
    prizes: ['Prêmio Surpresa'],
    isReady: false
  });
  const [tickets, setTickets] = useState({});
  
  // Estado do Usuário (Carrinho e Compra)
  const [selectedNumbers, setSelectedNumbers] = useState([]);
  const [checkoutModalOpen, setCheckoutModalOpen] = useState(false);
  const [buyerInfo, setBuyerInfo] = useState({ name: '', phone: '' });
  const [paymentStep, setPaymentStep] = useState('form'); // form, pix, success
  const [confirmedNumbers, setConfirmedNumbers] = useState([]); // Números confirmados na última compra

  // --- CARREGAMENTO DINÂMICO DO JSPDF ---
  useEffect(() => {
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
    script.async = true;
    document.body.appendChild(script);
    return () => {
      if (document.body.contains(script)) {
        document.body.removeChild(script);
      }
    };
  }, []);

  // --- 1. INICIALIZAÇÃO E AUTENTICAÇÃO (Regra 3) ---
  useEffect(() => {
    const initAuth = async () => {
      try {
        if (initialAuthToken) {
          await signInWithCustomToken(auth, initialAuthToken);
        } else {
          await signInAnonymously(auth);
        }
      } catch (error) {
        console.error("Erro na autenticação:", error);
      }
    };
    initAuth();

    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      // Se o usuário está logado e não é anônimo (ou seja, usou e-mail/senha), ele é admin
      if (currentUser && !currentUser.isAnonymous) {
        setIsAdmin(true);
      } else {
        setIsAdmin(false);
        setAdminDashboardOpen(false);
      }
    });
    return () => unsubscribe();
  }, []);

  // --- FUNÇÕES DE LOGIN/LOGOUT DO ADMIN ---
  const handleAdminLogin = async (e) => {
    e.preventDefault();
    setAdminError('');
    try {
      await signInWithEmailAndPassword(auth, adminEmail, adminPassword);
      setAdminEmail('');
      setAdminPassword('');
      setAdminLoginOpen(false);
      setAdminDashboardOpen(true);
    } catch (error) {
      console.error("Erro no login:", error);
      setAdminError('E-mail ou senha incorretos.');
    }
  };

  const handleAdminLogout = async () => {
    try {
      await signOut(auth);
      // Volta a logar anonimamente para o usuário continuar navegando e comprando rifas normalmente
      await signInAnonymously(auth);
      setAdminLoginOpen(false);
      setAdminDashboardOpen(false);
    } catch (error) {
      console.error("Erro ao sair:", error);
    }
  };

  // --- 2. BUSCA DE DADOS COM TRATAMENTO DE PERMISSÕES SEGURO ---
  useEffect(() => {
    if (!user) return;

    const settingsRef = doc(db, ...SETTINGS_PATH, 'main');
    const ticketsRef = doc(db, ...TICKETS_PATH, 'main');

    let unsubSettings = () => {};
    let unsubTickets = () => {};

    const setupFirebaseData = async () => {
      // Tenta ler e inicializar configurações iniciais.
      // Se falhar (ex: visitante anônimo sem permissão de escrita), o catch trata sem quebrar o app.
      try {
        const snap = await getDoc(settingsRef);
        if (!snap.exists()) {
          await setDoc(settingsRef, {
            totalNumbers: 300,
            price: 20,
            drawDate: 'A definir',
            prizes: ['Prêmio de Agradecimento Especial'],
          }, { merge: true });
          await setDoc(ticketsRef, { data: {} }, { merge: true });
        }
      } catch {
        console.warn("Aviso: Inicialização automática pulada (normal para usuários sem permissão de gravação).");
      }

      // Registra observador de configurações com tratamento de falhas
      unsubSettings = onSnapshot(settingsRef, (docSnap) => {
        if (docSnap.exists()) {
          setConfig({ ...docSnap.data(), isReady: true });
        } else {
          setConfig(prev => ({ ...prev, isReady: true }));
        }
      }, (err) => {
        console.error("Erro ao escutar configurações:", err);
        // Libera a tela mesmo em caso de erro de leitura
        setConfig(prev => ({ ...prev, isReady: true }));
      });

      // Registra observador de bilhetes com tratamento de falhas
      unsubTickets = onSnapshot(ticketsRef, (docSnap) => {
        if (docSnap.exists()) {
          setTickets(docSnap.data().data || {});
        }
        setLoading(false);
      }, (err) => {
        console.error("Erro ao escutar bilhetes de rifa:", err);
        setLoading(false);
      });
    };

    setupFirebaseData();

    return () => {
      unsubSettings();
      unsubTickets();
    };
  }, [user]);

  // --- FUNÇÕES DE COMPRA E PDF ---
  const toggleNumber = (num) => {
    if (tickets[num] && tickets[num].status === 'sold') return;
    
    if (selectedNumbers.includes(num)) {
      setSelectedNumbers(selectedNumbers.filter(n => n !== num));
    } else {
      if (selectedNumbers.length >= 10) {
        alert("Você pode selecionar no máximo 10 números por vez.");
        return;
      }
      setSelectedNumbers([...selectedNumbers, num]);
    }
  };

  const handleCheckoutSubmit = (e) => {
    e.preventDefault();
    if (!PURCHASES_ENABLED) return;
    if (!buyerInfo.name || !buyerInfo.phone) {
      alert("Por favor, preencha nome e telefone.");
      return;
    }
    setPaymentStep('pix');
  };

  const simulatePaymentSuccess = async () => {
    if (!PURCHASES_ENABLED || !user) return;
    const ticketsRef = doc(db, ...TICKETS_PATH, 'main');
    
    const purchasedAt = new Date().toISOString();

    try {
      await runTransaction(db, async (transaction) => {
        const ticketsSnapshot = await transaction.get(ticketsRef);
        const currentTickets = ticketsSnapshot.exists() ? ticketsSnapshot.data().data || {} : {};
        const unavailableNumber = selectedNumbers.find(num => currentTickets[num]?.status === 'sold');

        if (unavailableNumber) {
          throw new Error(`NUMBER_ALREADY_SOLD:${unavailableNumber}`);
        }

        const updates = {};
        selectedNumbers.forEach(num => {
          updates[`data.${num}`] = {
            status: 'sold',
            buyerName: buyerInfo.name,
            buyerPhone: buyerInfo.phone,
            purchasedAt
          };
        });
        transaction.set(ticketsRef, updates, { merge: true });
      });
      setConfirmedNumbers([...selectedNumbers]); // Salva para o PDF
      setPaymentStep('success');
      setSelectedNumbers([]); // Limpa carrinho
    } catch (error) {
      console.error("Erro ao registrar compra:", error);
      if (error.message?.startsWith('NUMBER_ALREADY_SOLD:')) {
        setSelectedNumbers(current => current.filter(num => num !== error.message.split(':')[1]));
        alert("Um dos números selecionados acabou de ser vendido. Confira sua seleção e tente novamente.");
      } else {
        alert("Houve um erro ao processar sua compra. Nenhum número foi confirmado.");
      }
    }
  };

  const generatePDF = () => {
    if (!window.jspdf) {
      alert("Aguarde um momento, o gerador de PDF está sendo carregado...");
      return;
    }
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 20;
    let yPos = margin;

    // Cabeçalho
    doc.setFontSize(18);
    doc.setTextColor(0, 156, 59); // Verde Amapá
    doc.text("Comprovante da Rifa Solidária - Atleta Belo", pageWidth / 2, yPos, { align: "center" });
    yPos += 10;
    doc.setFontSize(12);
    doc.setTextColor(0, 0, 0);
    doc.text("Campeonato Mundial de Triatlo 2026 - Pontevedra, Espanha", pageWidth / 2, yPos, { align: "center" });
    yPos += 15;

    // Dados do Comprador
    doc.setFontSize(14);
    doc.setTextColor(0, 156, 59);
    doc.text("Dados do Comprador", margin, yPos);
    yPos += 8;
    doc.setFontSize(12);
    doc.setTextColor(0, 0, 0);
    doc.text(`Nome: ${buyerInfo.name}`, margin, yPos);
    yPos += 6;
    doc.text(`Telefone: ${buyerInfo.phone}`, margin, yPos);
    yPos += 6;
    doc.text(`Data da Compra: ${new Date().toLocaleDateString()} às ${new Date().toLocaleTimeString()}`, margin, yPos);
    yPos += 15;

    // Números Adquiridos
    doc.setFontSize(14);
    doc.setTextColor(0, 156, 59);
    doc.text("Números Adquiridos", margin, yPos);
    yPos += 8;
    doc.setFontSize(12);
    doc.setTextColor(0, 0, 0);
    
    confirmedNumbers.forEach((num, index) => {
      if (index > 0 && index % 5 === 0) {
        yPos += 6;
        doc.text("", margin, yPos); // Nova linha a cada 5 números
      }
      const xPos = margin + (index % 5) * 35;
      doc.setDrawColor(255, 223, 0); // Amarelo Amapá
      doc.setFillColor(255, 250, 205); // Fundo amarelo claro
      doc.roundedRect(xPos, yPos - 4, 30, 8, 2, 2, 'FD');
      doc.text(num, xPos + 15, yPos + 1, { align: "center" });
    });
    yPos += 15;

    // Rodapé
    doc.setFontSize(10);
    doc.setTextColor(100, 100, 100);
    doc.text("Este documento é um comprovante de participação na ação solidária.", pageWidth / 2, yPos, { align: "center" });
    yPos += 5;
    doc.text("Boa sorte!", pageWidth / 2, yPos, { align: "center" });

    doc.save(`Comprovante_Rifa_Belo_${buyerInfo.name.split(' ')[0]}.pdf`);
  };

  const totalValue = selectedNumbers.length * config.price;

  // --- UI DO APP ---
  if (loading || !config.isReady) {
    return <div className="flex h-screen items-center justify-center bg-slate-50"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-yellow-400"></div></div>;
  }

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-800 pb-24">
      {/* HEADER - Cores da Logo Belo */}
      <header className="bg-[#293c8d] text-white shadow-md sticky top-0 z-40 border-b-4 border-yellow-400">
        <div className="max-w-4xl mx-auto px-4 py-3 flex justify-between items-center">
          <div className="flex items-center gap-2">
            <img src="Logo Belo.png" alt="Logo Belo Atleta Triathlon" className="h-12 md:h-16 object-contain drop-shadow-md" />
          </div>
          <button 
            onClick={() => isAdmin ? setAdminDashboardOpen(true) : setAdminLoginOpen(true)}
            className="text-yellow-200 hover:text-white p-2 transition-colors"
            title="Área do Administrador"
          >
            {isAdmin ? <Settings className="w-5 h-5" /> : <Lock className="w-5 h-5" />}
          </button>
        </div>
        
      </header>

      {adminLoginOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="bg-[#293c8d] px-6 py-5 text-white">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-[0.18em] text-yellow-300">Acesso restrito</p>
                  <h2 className="text-2xl font-extrabold">Área administrativa</h2>
                  <p className="mt-1 text-sm text-blue-100">Entre para acompanhar as vendas da rifa.</p>
                </div>
                <button type="button" onClick={() => { setAdminLoginOpen(false); setAdminError(''); }} className="rounded-lg p-2 text-blue-100 transition-colors hover:bg-white/10 hover:text-white" aria-label="Fechar login">
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>
            <form onSubmit={handleAdminLogin} className="space-y-4 p-6">
              <div>
                <label htmlFor="admin-email" className="mb-1.5 block text-sm font-semibold text-slate-700">E-mail</label>
                <input id="admin-email" type="email" required autoFocus placeholder="seu@email.com" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} className="w-full rounded-xl border border-slate-300 px-4 py-3 text-slate-900 outline-none transition focus:border-[#293c8d] focus:ring-2 focus:ring-blue-100" />
              </div>
              <div>
                <label htmlFor="admin-password" className="mb-1.5 block text-sm font-semibold text-slate-700">Senha</label>
                <input id="admin-password" type="password" required placeholder="Digite sua senha" value={adminPassword} onChange={(e) => setAdminPassword(e.target.value)} className="w-full rounded-xl border border-slate-300 px-4 py-3 text-slate-900 outline-none transition focus:border-[#293c8d] focus:ring-2 focus:ring-blue-100" />
              </div>
              {adminError && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{adminError}</p>}
              <button type="submit" className="w-full rounded-xl bg-green-700 px-4 py-3 font-bold text-white shadow-sm transition hover:bg-green-800">Entrar no painel</button>
              <p className="text-center text-xs text-slate-500">Acesso protegido por autenticação do Firebase.</p>
            </form>
          </div>
        </div>
      )}

      <main className="max-w-4xl mx-auto px-4 py-6 relative">
        {/* Background Image Banner */}
        <div className="absolute top-0 left-0 w-full h-64 z-0 overflow-hidden rounded-b-2xl shadow-md">
          <img src="Belo.jpeg" alt="Atleta Belo" className="w-full h-full object-cover object-center opacity-90" />
          <div className="absolute inset-0 bg-gradient-to-t from-[#293c8d]/90 via-[#293c8d]/40 to-transparent"></div>
        </div>
        
        {/* HERO SECTION */}
        <section className="relative z-10 mt-32 bg-white rounded-2xl shadow-lg overflow-hidden mb-8 border border-blue-100">
          <div className="px-6 py-6 text-center">
            <h2 className="text-2xl md:text-4xl font-extrabold mb-2 text-[#293c8d]">Rifa Solidária: Atleta Belo</h2>
            <p className="text-slate-600 mb-4 max-w-2xl mx-auto font-medium">
              Ajude o campeão amapaense a custear sua viagem para o Campeonato Mundial de Triatlo 2026 em Pontevedra, Espanha!
            </p>
            <div className="inline-flex items-center gap-2 bg-yellow-400 text-[#293c8d] px-4 py-2 rounded-full font-bold shadow-md transform hover:scale-105 transition-transform">
              <Ticket className="w-5 h-5" />
              <span>Apenas R$ {config.price.toFixed(2).replace('.', ',')} o número</span>
            </div>
          </div>

          <div className="p-6 md:p-8 flex flex-col md:flex-row gap-8 bg-blue-50/50 border-t border-blue-100">
            <div className="flex-1 space-y-4">
              <div className="flex items-start gap-3">
                <Calendar className="w-6 h-6 text-green-600 shrink-0" />
                <div>
                  <h3 className="font-bold text-[#293c8d]">Data do Sorteio</h3>
                  <p className="text-slate-600">{config.drawDate}</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Trophy className="w-6 h-6 text-green-600 shrink-0" />
                <div>
                  <h3 className="font-bold text-[#293c8d]">Prêmios</h3>
                  <ul className="text-slate-600 list-disc list-inside">
                    {config.prizes.map((prize, idx) => (
                      <li key={idx}>{prize}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
            
          </div>
        </section>

        {/* INSTRUCTIONS */}
        <div className="mb-6 flex gap-4 justify-center text-sm font-medium">
          <div className="flex items-center gap-1"><div className="w-4 h-4 rounded-full border-2 border-green-500 bg-white"></div> Disponível</div>
          <div className="flex items-center gap-1"><div className="w-4 h-4 rounded-full bg-yellow-400 border-2 border-yellow-500"></div> Selecionado</div>
          <div className="flex items-center gap-1"><div className="w-4 h-4 rounded-full bg-blue-800"></div> Vendido</div>
        </div>

        {/* GRID DE NÚMEROS - Cores do Amapá */}
        <section className="bg-white p-4 md:p-6 rounded-2xl shadow-lg border border-blue-100">
          <h3 className="text-lg font-bold mb-4 text-center text-[#293c8d]">Escolha seus números da sorte</h3>
          <div className="grid grid-cols-5 sm:grid-cols-8 md:grid-cols-10 lg:grid-cols-12 gap-2">
            {Array.from({ length: config.totalNumbers }).map((_, i) => {
              const num = String(i + 1).padStart(3, '0');
              const ticketData = tickets[num];
              const isSold = ticketData?.status === 'sold';
              const isSelected = selectedNumbers.includes(num);

              let btnClass = "relative w-full aspect-square rounded-lg flex items-center justify-center text-sm sm:text-base font-bold transition-all ";
              
              if (isSold) {
                btnClass += "bg-blue-800 text-blue-200 cursor-not-allowed";
              } else if (isSelected) {
                btnClass += "bg-yellow-400 text-green-900 shadow-md transform scale-105 border-2 border-yellow-500";
              } else {
                btnClass += "bg-white border-2 border-green-200 text-green-700 hover:border-yellow-400 hover:text-green-900 hover:shadow-sm cursor-pointer";
              }

              return (
                <button
                  key={num}
                  onClick={() => toggleNumber(num)}
                  disabled={isSold}
                  className={btnClass}
                >
                  {num}
                  {isSold && <CheckCircle className="absolute w-4 h-4 text-blue-300 opacity-70" />}
                </button>
              );
            })}
          </div>
        </section>
      </main>

      {/* FLOATING CART BAR - Cores do Amapá */}
      {selectedNumbers.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t-4 border-yellow-400 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.1)] z-50 p-4">
          <div className="max-w-4xl mx-auto flex justify-between items-center">
            <div>
              <p className="text-sm text-green-600 font-medium">{selectedNumbers.length} número(s) selecionado(s)</p>
              <p className="text-xl font-bold text-[#293c8d]">Total: R$ {totalValue.toFixed(2).replace('.', ',')}</p>
            </div>
            {PURCHASES_ENABLED ? (
              <button 
                onClick={() => { setCheckoutModalOpen(true); setPaymentStep('form'); }}
                className="bg-green-600 hover:bg-green-700 text-white px-6 py-3 rounded-xl font-bold shadow-lg flex items-center gap-2 transition-colors"
              >
                <ShoppingCart className="w-5 h-5" />
                Comprar Agora
              </button>
            ) : (
              <p className="max-w-xs text-right text-sm font-medium text-slate-600">
                Compras temporariamente indisponíveis. Fale conosco pelo WhatsApp.
              </p>
            )}
          </div>
        </div>
      )}

      {isAdmin && adminDashboardOpen && (
        <div className="fixed inset-0 z-[60] overflow-y-auto bg-slate-100">
          <div className="min-h-screen">
            <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 shadow-sm backdrop-blur">
              <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 md:px-8">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#293c8d] text-yellow-300 shadow-sm">
                    <Settings className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold uppercase tracking-wide text-slate-500">Rifa Solidária</p>
                    <h1 className="truncate text-lg font-extrabold text-[#293c8d] md:text-xl">Centro de controle</h1>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button onClick={() => setAdminDashboardOpen(false)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50">Voltar ao site</button>
                  <button onClick={handleAdminLogout} className="rounded-lg bg-[#293c8d] px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-950">Sair</button>
                </div>
              </div>
            </header>
            <main className="mx-auto max-w-6xl px-4 py-6 md:px-8 md:py-8">
              <div className="mb-6 flex flex-col gap-1">
                <p className="text-sm font-semibold text-green-700">Visão operacional</p>
                <h2 className="text-2xl font-extrabold tracking-tight text-slate-900 md:text-3xl">Acompanhe as vendas</h2>
                <p className="max-w-2xl text-sm text-slate-600">Consulte compradores, acompanhe os números e exporte um relatório sem modificar os registros da rifa.</p>
              </div>
              <AdminPanel config={config} tickets={tickets} />
            </main>
          </div>
        </div>
      )}

      {/* WHATSAPP FLOAT BUTTON */}
      <a 
        href="https://wa.me/5596991909077?text=Olá,%20gostaria%20de%20tirar%20uma%20dúvida%20sobre%20a%20Rifa%20Solidária%20do%20Atleta%20Belo."
        target="_blank"
        rel="noopener noreferrer"
        className="fixed bottom-24 right-4 bg-green-500 text-white p-3 rounded-full shadow-lg hover:bg-green-600 transition-colors z-40"
        title="Dúvidas? Fale no WhatsApp"
      >
        <MessageCircle className="w-6 h-6" />
      </a>

      {/* CHECKOUT MODAL - Cores do Amapá */}
      {checkoutModalOpen && (
        <div className="fixed inset-0 bg-green-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md overflow-hidden shadow-2xl animate-in fade-in zoom-in duration-200 border-t-4 border-yellow-400">
            
            <div className="bg-green-50 px-6 py-4 border-b border-green-100 flex justify-between items-center">
              <h3 className="font-bold text-lg text-green-800">Finalizar Compra</h3>
              {paymentStep !== 'success' && <button onClick={() => setCheckoutModalOpen(false)} className="text-green-400 hover:text-green-600"><X /></button>}
            </div>

            <div className="p-6">
              {paymentStep === 'form' && (
                <form onSubmit={handleCheckoutSubmit} className="space-y-4">
                  <div className="bg-yellow-50 text-yellow-800 p-3 rounded-lg text-sm mb-4 border border-yellow-200">
                    <strong>Números:</strong> {selectedNumbers.join(', ')}<br/>
                    <strong>Valor a pagar:</strong> R$ {totalValue.toFixed(2).replace('.', ',')}
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-green-700 mb-1">Nome Completo</label>
                    <div className="relative">
                      <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-green-400" />
                      <input 
                        type="text" required
                        className="w-full pl-10 pr-3 py-2 border border-green-200 rounded-lg focus:ring-2 focus:ring-green-500 outline-none"
                        placeholder="João da Silva"
                        value={buyerInfo.name} onChange={e => setBuyerInfo({...buyerInfo, name: e.target.value})}
                      />
                    </div>
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-green-700 mb-1">WhatsApp / Telefone</label>
                    <div className="relative">
                      <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-green-400" />
                      <input 
                        type="tel" required
                        className="w-full pl-10 pr-3 py-2 border border-green-200 rounded-lg focus:ring-2 focus:ring-green-500 outline-none"
                        placeholder="(96) 90000-0000"
                        value={buyerInfo.phone} onChange={e => setBuyerInfo({...buyerInfo, phone: e.target.value})}
                      />
                    </div>
                  </div>

                  <button type="submit" className="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-3 rounded-xl mt-4 shadow-md transition-colors">
                    Pagar com Mercado Pago (PIX)
                  </button>
                </form>
              )}

              {paymentStep === 'pix' && (
                <div className="text-center space-y-4">
                  <div className="w-48 h-48 bg-slate-100 mx-auto border-2 border-dashed border-slate-300 flex items-center justify-center rounded-xl">
                    <p className="text-slate-500 text-sm p-4">
                      [QR CODE MERCADO PAGO]<br/>
                      *Na integração real, o QR Code gerado pela API do MP aparecerá aqui.*
                    </p>
                  </div>
                  <p className="text-sm text-slate-600">Copie o código PIX abaixo ou escaneie o QR Code.</p>
                  <input type="text" readOnly value="00020126580014br.gov.bcb.pix..." className="w-full text-center bg-slate-50 border p-2 rounded text-sm text-slate-500" />
                  
                  <div className="pt-4 border-t border-slate-100 mt-6">
                    <p className="text-xs text-yellow-800 mb-2 font-medium bg-yellow-50 p-2 rounded border border-yellow-200">
                      ⚠️ MODO DEMONSTRAÇÃO: Clique no botão abaixo para simular que o Mercado Pago confirmou o pagamento.
                    </p>
                    <button onClick={simulatePaymentSuccess} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-xl shadow-md transition-colors">
                      Simular Confirmação de Pagamento
                    </button>
                  </div>
                </div>
              )}

              {paymentStep === 'success' && (
                <div className="text-center py-6 animate-in fade-in zoom-in duration-300">
                  <CheckCircle className="w-20 h-20 text-green-500 mx-auto mb-4 drop-shadow-md" />
                  <h3 className="text-2xl font-bold text-green-800 mb-2">Pagamento Confirmado!</h3>
                  <p className="text-slate-600 mb-6">Obrigado por apoiar o Atleta Belo. Seus números já estão garantidos.</p>
                  
                  <button onClick={generatePDF} className="w-full bg-yellow-400 hover:bg-yellow-500 text-green-900 font-bold py-3 rounded-xl shadow-md flex items-center justify-center gap-2 mb-4 transition-colors">
                    <Download className="w-5 h-5" />
                    Baixar Comprovante em PDF
                  </button>

                  <button onClick={() => setCheckoutModalOpen(false)} className="text-green-600 hover:text-green-800 font-medium">
                    Voltar para o início
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// --- SUBCOMPONENTE: PAINEL DE ADMINISTRAÇÃO ---
function AdminPanel({ config, tickets }) {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('sold');

  const sales = Object.entries(tickets)
    .filter(([, ticket]) => ticket?.status === 'sold')
    .map(([number, ticket]) => ({ number, ...ticket }))
    .sort((first, second) => first.number.localeCompare(second.number));
  const availableCount = Math.max(Number(config.totalNumbers) - sales.length, 0);
  const estimatedRevenue = sales.length * Number(config.price || 0);
  const filteredTickets = (statusFilter === 'sold' ? sales : Object.entries(tickets)
    .filter(([, ticket]) => statusFilter === 'available' ? ticket?.status !== 'sold' : true)
    .map(([number, ticket]) => ({ number, ...ticket })))
    .filter(({ number, buyerName = '', buyerPhone = '' }) => {
      const query = searchTerm.trim().toLowerCase();
      return !query || `${number} ${buyerName} ${buyerPhone}`.toLowerCase().includes(query);
    });

  const exportSales = () => {
    const headers = ['Numero', 'Comprador', 'Telefone', 'Forma de pagamento', 'Data da compra', 'Status'];
    const rows = sales.map(sale => [sale.number, sale.buyerName || '', sale.buyerPhone || '', sale.paymentMethod || '', sale.purchasedAt || '', sale.status]);
    const csv = [headers, ...rows]
      .map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(';'))
      .join('\n');
    const blob = new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `relatorio-rifa-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="w-full bg-white p-4 md:p-6 rounded-xl border border-blue-200 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-slate-200 pb-4">
        <div className="flex items-center gap-2 text-[#293c8d]">
          <Settings className="w-5 h-5" />
          <div>
            <h3 className="font-bold">Painel administrativo</h3>
            <p className="text-xs text-slate-500">Relatórios em tempo real, sem alterar os dados.</p>
          </div>
        </div>
        <button onClick={exportSales} disabled={!sales.length} className="inline-flex items-center justify-center gap-2 rounded-lg bg-green-700 px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-green-800 disabled:cursor-not-allowed disabled:opacity-50">
          <Download className="w-4 h-4" /> Exportar vendas CSV
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 py-4 md:grid-cols-4">
        <div className="rounded-lg bg-blue-50 p-3"><p className="text-xs text-slate-600">Vendidos</p><p className="text-2xl font-bold text-[#293c8d]">{sales.length}</p></div>
        <div className="rounded-lg bg-green-50 p-3"><p className="text-xs text-slate-600">Disponíveis</p><p className="text-2xl font-bold text-green-700">{availableCount}</p></div>
        <div className="rounded-lg bg-yellow-50 p-3"><p className="text-xs text-slate-600">Arrecadação estimada</p><p className="text-lg font-bold text-yellow-800">R$ {estimatedRevenue.toFixed(2).replace('.', ',')}</p></div>
        <div className="rounded-lg bg-slate-50 p-3"><p className="text-xs text-slate-600">Compradores</p><p className="text-2xl font-bold text-slate-700">{new Set(sales.map(sale => `${sale.buyerName || ''}|${sale.buyerPhone || ''}`)).size}</p></div>
      </div>

      <div className="flex flex-col gap-2 md:flex-row">
        <label className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input value={searchTerm} onChange={event => setSearchTerm(event.target.value)} placeholder="Buscar por número, nome ou telefone" className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-blue-500" />
        </label>
        <select value={statusFilter} onChange={event => setStatusFilter(event.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500">
          <option value="sold">Vendidos</option>
          <option value="available">Disponíveis</option>
          <option value="all">Todos os registros</option>
        </select>
      </div>

      <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full min-w-[680px] text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="px-3 py-2">Número</th><th className="px-3 py-2">Comprador</th><th className="px-3 py-2">Telefone</th><th className="px-3 py-2">Pagamento</th><th className="px-3 py-2">Data</th><th className="px-3 py-2">Status</th></tr></thead>
          <tbody>
            {filteredTickets.map(ticket => <tr key={ticket.number} className="border-t border-slate-100"><td className="px-3 py-2 font-bold text-[#293c8d]">{ticket.number}</td><td className="px-3 py-2">{ticket.buyerName || '-'}</td><td className="px-3 py-2">{ticket.buyerPhone || '-'}</td><td className="px-3 py-2">{ticket.paymentMethod || '-'}</td><td className="px-3 py-2">{ticket.purchasedAt ? new Date(ticket.purchasedAt).toLocaleString('pt-BR') : '-'}</td><td className="px-3 py-2"><span className={ticket.status === 'sold' ? 'font-semibold text-blue-700' : 'font-semibold text-green-700'}>{ticket.status === 'sold' ? 'Vendido' : 'Disponível'}</span></td></tr>)}
            {!filteredTickets.length && <tr><td colSpan="6" className="px-3 py-6 text-center text-slate-500">Nenhum registro encontrado.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-slate-500">Exibindo {filteredTickets.length} registro(s). A arrecadação é uma estimativa baseada no preço configurado.</p>
    </div>
  );
}