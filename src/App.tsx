/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';

// --- TYPES ---

type Tab = 'PROYECTOS' | 'CLIENTES' | 'DOCUMENTOS' | 'MÉTRICAS';

type EstadoProyecto = 'en_tiempo' | 'en_riesgo' | 'atrasado' | 'completado' | 'pausado';

interface Tarea {
  id: string;
  descripcion: string;
  completada: boolean;
  fechaLimite?: string;
}

interface Proyecto {
  id: string;
  nombre: string;
  clienteId: string;
  clienteNombre: string;
  estado: EstadoProyecto;
  fechaInicio: string;
  fechaEntrega: string;
  descripcion: string;
  avancePorcentaje: number;
  valorTotal: number;
  montoRecibido: number;
  tareas: Tarea[];
  ultimaActualizacion: string;
  notas: string;
}

interface Cliente {
  id: string;
  nombre: string;
  empresa?: string;
  industria: string;
  email: string;
  telefono?: string;
  estado: 'activo' | 'prospecto' | 'pausado' | 'cerrado';
  valorHistorico: number;
  proyectosActivos: number;
  ultimoContacto: string;
  notas: string;
}

interface Documento {
  id: string;
  tipo: 'informe' | 'contrato' | 'propuesta';
  proyectoId?: string;
  clienteId: string;
  clienteNombre: string;
  contenido: string;
  creadoEn: string;
}

interface Cobro {
  id: string;
  clienteId: string;
  proyectoId?: string;
  monto: number;
  fecha: string;
  concepto: string;
}

interface Config {
  apiKey: string;
  nombreEmpresa: string;
  moneda: string;
}

// --- UTILS ---

const formatCurrency = (amount: number, currency: string) => {
  const val = isNaN(amount) ? 0 : amount;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency || 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(val);
};

const formatDate = (dateStr: string) => {
  const date = new Date(dateStr);
  return date.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' });
};

const generateId = (prefix: string) => {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
  return `${prefix}-${date}-${random}`;
};

// --- OPENAI INTEGRATION ---

async function callVortexia(apiKey: string, systemPrompt: string, userMessage: string, maxTokens = 800) {
  if (!apiKey) return null;

  try {
    // Limpiar API Key: eliminar espacios, comillas accidentales y asegurar que no sea un placeholder
    const cleanApiKey = apiKey.trim().replace(/["']/g, "");
    
    if (!cleanApiKey.startsWith('sk-')) {
      throw new Error('La API Key no parece válida. Debe comenzar con "sk-". Por favor, revísala en CONFIG.');
    }
    
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${cleanApiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage }
        ],
        temperature: 0.3,
        max_tokens: maxTokens
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || 'Error en la llamada a OpenAI');
    }

    const data = await response.json();
    return data.choices[0].message.content;
  } catch (error) {
    console.error('Vortexia Error:', error);
    return null;
  }
}

// --- COMPONENTS ---

const Typewriter = ({ text, speed = 10, onComplete }: { text: string, speed?: number, onComplete?: () => void }) => {
  const [displayedText, setDisplayedText] = useState('');
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (index < text.length) {
      const timeout = setTimeout(() => {
        setDisplayedText(prev => prev + text[index]);
        setIndex(prev => prev + 1);
      }, speed);
      return () => clearTimeout(timeout);
    } else if (onComplete) {
      onComplete();
    }
  }, [index, text, speed, onComplete]);

  return <div className="typewriter-text font-serif text-[18px] leading-[1.75] italic whitespace-pre-wrap">{displayedText}</div>;
};

const Toast = ({ message, type = 'ok' }: { message: string, type?: 'ok' | 'error' }) => {
  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 20 }}
      className={`fixed bottom-8 left-1/2 -translate-x-1/2 px-6 py-3 rounded-sm font-mono text-[10px] tracking-widest uppercase z-50 ${type === 'ok' ? 'bg-signal-ok text-white' : 'bg-signal-late text-white'}`}
      style={{ backgroundColor: type === 'ok' ? 'var(--signal-ok)' : 'var(--signal-late)' }}
    >
      {type === 'ok' ? '✓ ' : '× '}{message}
    </motion.div>
  );
};

// --- MAIN APP ---

export default function App() {
  const [config, setConfig] = useState<Config | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('PROYECTOS');
  const [proyectos, setProyectos] = useState<Proyecto[]>([]);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [documentos, setDocumentos] = useState<Documento[]>([]);
  const [cobros, setCobros] = useState<Cobro[]>([]);
  const [selectedProyectoId, setSelectedProyectoId] = useState<string | null>(null);
  const [selectedClienteId, setSelectedClienteId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string, type: 'ok' | 'error' } | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [showResetModal, setShowResetModal] = useState(false);

  const [showConfig, setShowConfig] = useState(false);

  // Load from LocalStorage
  useEffect(() => {
    try {
      const savedConfig = localStorage.getItem('command_config');
      const savedProyectos = localStorage.getItem('command_proyectos');
      const savedClientes = localStorage.getItem('command_clientes');
      const savedDocumentos = localStorage.getItem('command_documentos');
      const savedCobros = localStorage.getItem('command_cobros');

      if (savedConfig) setConfig(JSON.parse(savedConfig));
      if (savedProyectos) setProyectos(JSON.parse(savedProyectos));
      if (savedClientes) setClientes(JSON.parse(savedClientes));
      if (savedDocumentos) setDocumentos(JSON.parse(savedDocumentos));
      if (savedCobros) setCobros(JSON.parse(savedCobros));
    } catch (error) {
      console.error('Error cargando datos de localStorage:', error);
    }
    setIsLoaded(true);
  }, []);

  // Suppress MetaMask errors from extensions
  useEffect(() => {
    const handleError = (e: ErrorEvent) => {
      if (e.message && e.message.includes('MetaMask')) {
        e.preventDefault();
        console.warn('MetaMask connection error suppressed (external extension).');
      }
    };
    window.addEventListener('error', handleError);
    return () => window.removeEventListener('error', handleError);
  }, []);

  // Save to LocalStorage
  useEffect(() => {
    if (!isLoaded) return;
    if (config) localStorage.setItem('command_config', JSON.stringify(config));
    localStorage.setItem('command_proyectos', JSON.stringify(proyectos));
    localStorage.setItem('command_clientes', JSON.stringify(clientes));
    localStorage.setItem('command_documentos', JSON.stringify(documentos));
    localStorage.setItem('command_cobros', JSON.stringify(cobros));
  }, [config, proyectos, clientes, documentos, cobros, isLoaded]);

  const showToast = (message: string, type: 'ok' | 'error' = 'ok') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const handleOnboarding = (newConfig: Config) => {
    setConfig(newConfig);
    
    // Load Demo Data
    const demoClientes: Cliente[] = [
      {
        id: 'CLI-20240101-001',
        nombre: 'Nexus Tech Solutions',
        empresa: 'Nexus Corp',
        industria: 'Tecnología',
        email: 'contact@nexus.com',
        estado: 'activo',
        valorHistorico: 15000,
        proyectosActivos: 1,
        ultimoContacto: new Date().toISOString(),
        notas: 'Cliente recurrente de alto valor.'
      },
      {
        id: 'CLI-20240101-002',
        nombre: 'Artemis Design',
        empresa: 'Artemis Studio',
        industria: 'Diseño',
        email: 'hello@artemis.com',
        estado: 'prospecto',
        valorHistorico: 0,
        proyectosActivos: 1,
        ultimoContacto: new Date().toISOString(),
        notas: 'Interesados en renovación de marca.'
      }
    ];

    const demoProyectos: Proyecto[] = [
      {
        id: 'PRY-20240322-001',
        nombre: 'Plataforma E-commerce V2',
        clienteId: 'CLI-20240101-001',
        clienteNombre: 'Nexus Tech Solutions',
        estado: 'en_tiempo',
        fechaInicio: '2024-03-01',
        fechaEntrega: '2024-05-15',
        descripcion: 'Desarrollo de nueva arquitectura para tienda global.',
        avancePorcentaje: 35,
        valorTotal: 8500,
        montoRecibido: 3000,
        tareas: [
          { id: 'T1', descripcion: 'Definición de arquitectura', completada: true },
          { id: 'T2', descripcion: 'Diseño de UI/UX', completada: true },
          { id: 'T3', descripcion: 'Desarrollo de Backend', completada: false }
        ],
        ultimaActualizacion: new Date().toISOString(),
        notas: 'El cliente está muy satisfecho con los avances.'
      },
      {
        id: 'PRY-20240322-002',
        nombre: 'Identidad Visual Artemis',
        clienteId: 'CLI-20240101-002',
        clienteNombre: 'Artemis Design',
        estado: 'en_riesgo',
        fechaInicio: '2024-03-10',
        fechaEntrega: '2024-04-01',
        descripcion: 'Rediseño completo de logotipo y manual de marca.',
        avancePorcentaje: 15,
        valorTotal: 4500,
        montoRecibido: 0,
        tareas: [
          { id: 'T1', descripcion: 'Moodboard inicial', completada: true },
          { id: 'T2', descripcion: 'Bocetos de logo', completada: false }
        ],
        ultimaActualizacion: new Date().toISOString(),
        notas: 'Retraso en la entrega de feedback por parte del cliente.'
      }
    ];

    setClientes(demoClientes);
    setProyectos(demoProyectos);
    showToast('Sistema activado');
  };

  if (!config) {
    return <Onboarding onComplete={handleOnboarding} />;
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Header 
        activeTab={activeTab} 
        setActiveTab={setActiveTab} 
        config={config} 
        onReset={() => setShowResetModal(true)}
        onConfig={() => setShowConfig(true)}
      />
      
      <main className="flex-1 p-8 max-w-7xl mx-auto w-full">
        <AnimatePresence mode="wait">
          {activeTab === 'PROYECTOS' && (
            <ProyectosModule 
              key="proyectos"
              proyectos={proyectos} 
              setProyectos={setProyectos}
              clientes={clientes}
              selectedId={selectedProyectoId}
              setSelectedId={setSelectedProyectoId}
              config={config}
              showToast={showToast}
              documentos={documentos}
              setDocumentos={setDocumentos}
            />
          )}
          {activeTab === 'CLIENTES' && (
            <ClientesModule 
              key="clientes"
              clientes={clientes} 
              setClientes={setClientes}
              proyectos={proyectos}
              selectedId={selectedClienteId}
              setSelectedId={setSelectedClienteId}
              config={config}
              showToast={showToast}
            />
          )}
          {activeTab === 'DOCUMENTOS' && (
            <DocumentosModule 
              key="documentos"
              documentos={documentos}
              setDocumentos={setDocumentos}
              clientes={clientes}
              config={config}
              showToast={showToast}
            />
          )}
          {activeTab === 'MÉTRICAS' && (
            <MetricasModule 
              key="metricas"
              proyectos={proyectos}
              clientes={clientes}
              cobros={cobros}
              config={config}
              showToast={showToast}
            />
          )}
        </AnimatePresence>
      </main>

      <AnimatePresence>
        {toast && <Toast message={toast.message} type={toast.type} />}
      </AnimatePresence>

      {showConfig && (
        <Modal onClose={() => setShowConfig(false)}>
          <ConfigForm 
            config={config} 
            onSubmit={(newConfig: Config) => {
              setConfig(newConfig);
              setShowConfig(false);
              showToast('Configuración actualizada');
            }} 
          />
        </Modal>
      )}

      {showResetModal && (
        <Modal onClose={() => setShowResetModal(false)}>
          <div className="text-center py-8">
            <h3 className="text-[32px] font-light mb-6">¿Resetear Sistema?</h3>
            <p className="text-text-secondary mb-12 leading-relaxed">
              Esta acción eliminará todos los proyectos, clientes y configuraciones de forma permanente.
              No se puede deshacer.
            </p>
            <div className="flex flex-col gap-4">
              <button 
                className="btn-primary bg-signal-late border-signal-late hover:bg-signal-late/80" 
                onClick={() => {
                  localStorage.clear();
                  window.location.reload();
                }}
              >
                SÍ, BORRAR TODO
              </button>
              <button className="btn-secondary" onClick={() => setShowResetModal(false)}>CANCELAR</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// --- SUB-COMPONENTS ---

function Header({ activeTab, setActiveTab, config, onReset, onConfig }: { activeTab: Tab, setActiveTab: (t: Tab) => void, config: Config, onReset: () => void, onConfig: () => void }) {
  const [time, setTime] = useState(new Date());
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(err => {
        console.error(`Error attempting to enable full-screen mode: ${err.message}`);
      });
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      }
    }
  };

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  return (
    <header className="sticky top-0 z-40 bg-bg-primary/80 backdrop-blur-md border-b border-border">
      <div className="max-w-7xl mx-auto px-8 py-6">
        <div className="flex justify-between items-start mb-8">
          <div>
            <h1 className="text-[32px] font-semibold tracking-[0.4em] leading-none mb-1">VORTEXIA</h1>
            <p className="font-mono text-[10px] text-text-muted uppercase tracking-[0.2em]">{config.nombreEmpresa || 'Command Center'}</p>
          </div>
          <div className="flex items-center gap-8">
            <div className="flex items-center gap-3">
              <div className="w-2 h-2 rounded-full bg-accent animate-pulse shadow-[0_0_8px_var(--accent)]"></div>
              <span className="font-mono text-[10px] tracking-widest text-accent">ACTIVE SYSTEM</span>
            </div>
            <div className="font-mono text-[10px] text-text-muted tracking-widest">
              {time.toLocaleTimeString('en-US', { hour12: false })}
            </div>
            <div className="flex gap-6">
              <button onClick={toggleFullscreen} className="font-mono text-[10px] uppercase tracking-widest text-text-muted hover:text-accent transition-all">
                {isFullscreen ? 'EXIT FULLSCREEN' : 'FULLSCREEN'}
              </button>
              <button onClick={onConfig} className="font-mono text-[10px] uppercase tracking-widest text-text-muted hover:text-accent transition-all">CONFIG</button>
              <button onClick={onReset} className="font-mono text-[10px] uppercase tracking-widest text-signal-warn hover:text-signal-warn/80 transition-all">RESET</button>
            </div>
          </div>
        </div>

        <nav className="flex gap-12">
          {(['PROYECTOS', 'CLIENTES', 'DOCUMENTOS', 'MÉTRICAS'] as Tab[]).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`font-mono text-[10px] uppercase tracking-[0.2em] pb-2 transition-all relative ${activeTab === tab ? 'text-accent' : 'text-text-muted'}`}
            >
              {tab}
              {activeTab === tab && (
                <motion.div layoutId="nav-line" className="absolute bottom-0 left-0 right-0 h-[1px] bg-accent" />
              )}
            </button>
          ))}
        </nav>
      </div>
      <div className="h-[1px] w-full bg-gradient-to-r from-transparent via-accent/30 to-transparent" />
    </header>
  );
}

function Onboarding({ onComplete }: { onComplete: (c: Config) => void }) {
  const [formData, setFormData] = useState({
    nombreEmpresa: '',
    apiKey: '',
    moneda: 'USD'
  });

  return (
    <div className="fixed inset-0 bg-bg-primary z-50 flex items-center justify-center p-8">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="max-w-md w-full text-center"
      >
        <h1 className="text-[52px] font-semibold tracking-[0.4em] mb-2">VORTEXIA</h1>
        <p className="font-mono text-[12px] text-text-muted uppercase tracking-[0.2em] mb-8">Command Center</p>
        <p className="text-[22px] italic text-text-primary/80 mb-12">Tu operación. En un solo lugar.</p>
        
        <div className="flex flex-col gap-6 text-left">
          <div className="flex flex-col gap-2">
            <label className="font-mono text-[10px] text-text-muted uppercase tracking-widest">Nombre de tu empresa</label>
            <input 
              type="text" 
              placeholder="Ej. Vortexia Studio"
              value={formData.nombreEmpresa}
              onChange={e => setFormData({...formData, nombreEmpresa: e.target.value})}
            />
          </div>
          <div className="flex flex-col gap-2">
            <label className="font-mono text-[10px] text-text-muted uppercase tracking-widest">OpenAI API Key (sk-...)</label>
            <input 
              type="password" 
              placeholder="sk-..."
              value={formData.apiKey}
              onChange={e => setFormData({...formData, apiKey: e.target.value})}
            />
          </div>
          <div className="flex flex-col gap-2">
            <label className="font-mono text-[10px] text-text-muted uppercase tracking-widest">Moneda</label>
            <select 
              value={formData.moneda}
              onChange={e => setFormData({...formData, moneda: e.target.value})}
            >
              <option value="USD">USD — Dólar Estadounidense</option>
              <option value="CLP">CLP — Peso Chileno</option>
              <option value="MXN">MXN — Peso Mexicano</option>
              <option value="EUR">EUR — Euro</option>
              <option value="COP">COP — Peso Colombiano</option>
            </select>
          </div>
          
          <button 
            className="btn-primary w-full mt-4"
            onClick={() => {
              const cleanKey = formData.apiKey.trim().replace(/["']/g, "");
              if (formData.nombreEmpresa && cleanKey.startsWith('sk-')) {
                onComplete({ ...formData, apiKey: cleanKey });
              } else if (!cleanKey.startsWith('sk-')) {
                alert('La API Key debe empezar por "sk-". Por favor, revísala.');
              }
            }}
          >
            Iniciar
          </button>
        </div>
      </motion.div>
    </div>
  );
}

// --- MODULES ---

function ProyectosModule({ proyectos, setProyectos, clientes, selectedId, setSelectedId, config, showToast, documentos, setDocumentos }: any) {
  const [filter, setFilter] = useState('TODOS');
  const [isCreating, setIsCreating] = useState(false);

  const filteredProyectos = useMemo(() => {
    if (filter === 'TODOS') return proyectos;
    return proyectos.filter((p: any) => p.estado.toUpperCase() === filter.replace(' ', '_'));
  }, [proyectos, filter]);

  if (selectedId) {
    const proyecto = proyectos.find((p: any) => p.id === selectedId);
    return (
      <ProyectoDetail 
        proyecto={proyecto} 
        onBack={() => setSelectedId(null)} 
        onUpdate={(updated: any) => {
          setProyectos(proyectos.map((p: any) => p.id === updated.id ? updated : p));
        }}
        config={config}
        showToast={showToast}
        documentos={documentos}
        setDocumentos={setDocumentos}
      />
    );
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="flex justify-between items-end mb-12">
        <div>
          <h2 className="text-[48px] font-light mb-4">Proyectos</h2>
          <div className="flex gap-8">
            {['TODOS', 'EN TIEMPO', 'EN RIESGO', 'ATRASADOS', 'COMPLETADOS'].map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`font-mono text-[10px] uppercase tracking-[0.2em] pb-1 border-b transition-all ${filter === f ? 'text-accent border-accent' : 'text-text-muted border-transparent'}`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
        <button className="btn-primary" onClick={() => setIsCreating(true)}>Crear Proyecto</button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredProyectos.map((p: any, i: number) => (
          <ProyectoCard key={p.id} proyecto={p} onClick={() => setSelectedId(p.id)} index={i} />
        ))}
        {filteredProyectos.length === 0 && (
          <div className="col-span-full py-20 text-center border border-dashed border-border-mid">
            <p className="text-text-muted font-mono text-[12px] uppercase tracking-widest">Sin proyectos registrados.</p>
          </div>
        )}
      </div>

      {isCreating && (
        <Modal onClose={() => setIsCreating(false)}>
          <CreateProyectoForm 
            clientes={clientes} 
            onSubmit={(newP: any) => {
              setProyectos([...proyectos, newP]);
              setIsCreating(false);
              showToast('Proyecto creado');
            }} 
          />
        </Modal>
      )}
    </motion.div>
  );
}

function ProyectoCard({ proyecto, onClick, index }: any) {
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'en_tiempo': return 'var(--signal-ok)';
      case 'en_riesgo': return 'var(--signal-warn)';
      case 'atrasado': return 'var(--signal-late)';
      default: return 'var(--text-muted)';
    }
  };

  const isLate = new Date(proyecto.fechaEntrega) < new Date() && proyecto.estado !== 'completado';
  const isUrgent = !isLate && (new Date(proyecto.fechaEntrega).getTime() - new Date().getTime()) < 7 * 24 * 60 * 60 * 1000;

  return (
    <motion.div 
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.09 }}
      onClick={onClick}
      className="bg-bg-secondary border border-border p-6 cursor-pointer hover:border-border-mid transition-all group"
    >
      <div className="flex justify-between items-start mb-6">
        <div>
          <h3 className="text-[22px] font-normal mb-1 leading-tight">{proyecto.nombre}</h3>
          <p className="font-mono text-[10px] text-text-muted uppercase tracking-widest">{proyecto.clienteNombre}</p>
        </div>
        <span 
          className="font-mono text-[9px] uppercase tracking-widest px-2 py-1 border"
          style={{ color: getStatusColor(proyecto.estado), borderColor: getStatusColor(proyecto.estado) }}
        >
          {proyecto.estado.replace('_', ' ')}
        </span>
      </div>

      <div className="mb-6">
        <div className="flex justify-between items-end mb-2">
          <span className="font-mono text-[11px] text-text-secondary">{proyecto.avancePorcentaje}%</span>
        </div>
        <div className="h-[3px] w-full bg-border-mid">
          <motion.div 
            initial={{ width: 0 }}
            animate={{ width: `${proyecto.avancePorcentaje}%` }}
            className="h-full"
            style={{ backgroundColor: getStatusColor(proyecto.estado) === 'var(--text-muted)' ? 'var(--accent)' : getStatusColor(proyecto.estado) }}
          />
        </div>
      </div>

      <div className="flex justify-between items-end">
        <div>
          <p className={`font-mono text-[10px] mb-2 ${isLate ? 'text-signal-late' : isUrgent ? 'text-signal-warn' : 'text-text-muted'}`}>
            Entrega: {formatDate(proyecto.fechaEntrega)}
          </p>
          <p className="text-[20px] text-accent font-light">{formatCurrency(proyecto.valorTotal, 'USD')}</p>
        </div>
        <p className="font-mono text-[9px] text-text-muted uppercase tracking-widest">
          {Math.round((proyecto.montoRecibido / proyecto.valorTotal) * 100)}% cobrado
        </p>
      </div>
    </motion.div>
  );
}

function ProyectoDetail({ proyecto, onBack, onUpdate, config, showToast, documentos, setDocumentos }: any) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedReport, setGeneratedReport] = useState<string | null>(null);
  const [newTarea, setNewTarea] = useState('');

  const handleGenerateReport = async () => {
    setIsGenerating(true);
    setGeneratedReport(null);

    const systemPrompt = `Eres el asistente de comunicación de un empresario serio. Tu trabajo es generar informes de avance profesionales para clientes.
    El informe debe seguir esta estructura exacta:
    [ENCABEZADO] Informe de Avance — [Nombre del Proyecto], Cliente: [Nombre del cliente], Período: [rango], Avance: [X%]
    [RESUMEN EJECUTIVO] Una sola oración.
    [LO QUE SE COMPLETÓ] Lista de 3-5 avances.
    [EN PROCESO] 2-3 puntos.
    [PRÓXIMOS PASOS] 2-3 acciones.
    [ESTADO DEL PROYECTO] Una línea.
    TONO: Profesional, directo, sin relleno. Solo hechos.`;

    const userMessage = `Proyecto: ${proyecto.nombre}
    Cliente: ${proyecto.clienteNombre}
    Descripción: ${proyecto.descripcion}
    Avance: ${proyecto.avancePorcentaje}%
    Tareas completadas: ${proyecto.tareas.filter((t: any) => t.completada).map((t: any) => t.descripcion).join(', ')}
    Tareas pendientes: ${proyecto.tareas.filter((t: any) => !t.completada).map((t: any) => t.descripcion).join(', ')}
    Notas: ${proyecto.notas}`;

    const result = await callVortexia(config.apiKey, systemPrompt, userMessage, 1200);
    
    if (result) {
      setGeneratedReport(result);
    } else {
      showToast('Error al generar informe', 'error');
    }
    setIsGenerating(false);
  };

  const handleSaveReport = () => {
    if (!generatedReport) return;
    const newDoc: Documento = {
      id: generateId('DOC'),
      tipo: 'informe',
      proyectoId: proyecto.id,
      clienteId: proyecto.clienteId,
      clienteNombre: proyecto.clienteNombre,
      contenido: generatedReport,
      creadoEn: new Date().toISOString()
    };
    setDocumentos([newDoc, ...documentos]);
    showToast('Informe guardado');
  };

  const toggleTarea = (id: string) => {
    const updatedTareas = proyecto.tareas.map((t: any) => t.id === id ? { ...t, completada: !t.completada } : t);
    const completedCount = updatedTareas.filter((t: any) => t.completada).length;
    const newAvance = Math.round((completedCount / updatedTareas.length) * 100);
    onUpdate({ ...proyecto, tareas: updatedTareas, avancePorcentaje: newAvance });
  };

  const addTarea = () => {
    if (!newTarea) return;
    const updatedTareas = [...proyecto.tareas, { id: Math.random().toString(), descripcion: newTarea, completada: false }];
    onUpdate({ ...proyecto, tareas: updatedTareas });
    setNewTarea('');
  };

  return (
    <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
      <button onClick={onBack} className="btn-ghost mb-8 p-0 flex items-center gap-2">◀ VOLVER</button>
      
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-16">
        <div>
          <h2 className="text-[36px] font-light mb-2">{proyecto.nombre}</h2>
          <p className="font-mono text-[12px] text-accent uppercase tracking-[0.2em] mb-8">{proyecto.clienteNombre}</p>
          
          <div className="mb-12">
            <p className="text-text-secondary text-[16px] leading-relaxed mb-8">{proyecto.descripcion}</p>
            
            <div className="grid grid-cols-2 gap-8 mb-12">
              <div>
                <label className="font-mono text-[9px] text-text-muted uppercase tracking-widest block mb-2">Estado</label>
                <select 
                  value={proyecto.estado} 
                  onChange={e => onUpdate({...proyecto, estado: e.target.value})}
                  className="w-full"
                >
                  <option value="en_tiempo">En Tiempo</option>
                  <option value="en_riesgo">En Riesgo</option>
                  <option value="atrasado">Atrasado</option>
                  <option value="completado">Completado</option>
                  <option value="pausado">Pausado</option>
                </select>
              </div>
              <div>
                <label className="font-mono text-[9px] text-text-muted uppercase tracking-widest block mb-2">Avance</label>
                <div className="flex items-center gap-4">
                  <input 
                    type="range" 
                    min="0" max="100" 
                    value={proyecto.avancePorcentaje || 0} 
                    onChange={e => onUpdate({...proyecto, avancePorcentaje: parseInt(e.target.value) || 0})}
                    className="flex-1"
                  />
                  <span className="font-mono text-[13px]">{proyecto.avancePorcentaje || 0}%</span>
                </div>
              </div>
            </div>

            <div className="mb-12">
              <div className="flex justify-between items-center mb-4">
                <h4 className="font-mono text-[11px] uppercase tracking-widest">Tareas</h4>
                <button className="btn-ghost" onClick={addTarea}>+ AGREGAR TAREA</button>
              </div>
              <div className="flex flex-col gap-3">
                {proyecto.tareas.map((t: any) => (
                  <div key={t.id} className="flex items-center gap-4 group">
                    <input 
                      type="checkbox" 
                      checked={t.completada} 
                      onChange={() => toggleTarea(t.id)}
                      className="w-4 h-4 accent-accent"
                    />
                    <span className={`text-[16px] transition-all ${t.completada ? 'line-through text-text-muted' : 'text-text-primary'}`}>
                      {t.descripcion}
                    </span>
                  </div>
                ))}
                <input 
                  type="text" 
                  placeholder="Nueva tarea..." 
                  value={newTarea}
                  onChange={e => setNewTarea(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && addTarea()}
                  className="bg-transparent border-none border-b border-border-mid p-0 focus:border-accent"
                />
              </div>
            </div>

            <div>
              <label className="font-mono text-[9px] text-text-muted uppercase tracking-widest block mb-2">Notas Internas</label>
              <textarea 
                className="w-full h-32 resize-none"
                placeholder="Solo tú ves esto."
                value={proyecto.notas}
                onChange={e => onUpdate({...proyecto, notas: e.target.value})}
              />
            </div>
          </div>
        </div>

        <div className="bg-bg-secondary border border-border p-8 h-fit sticky top-32">
          <div className="flex justify-between items-center mb-8">
            <h3 className="font-mono text-[11px] uppercase tracking-[0.3em]">Informe de Avance</h3>
            {!isGenerating && !generatedReport && (
              <button className="btn-primary" onClick={handleGenerateReport}>Generar Informe</button>
            )}
          </div>

          <div className="relative min-h-[200px]">
            {isGenerating && (
              <div className="absolute top-0 left-0 w-full">
                <div className="golden-loader mb-4" />
                <p className="font-mono text-[10px] text-accent uppercase tracking-widest animate-pulse">Generando...</p>
              </div>
            )}

            {generatedReport && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="border-l-2 border-accent pl-8">
                <Typewriter text={generatedReport} speed={8} onComplete={() => {}} />
                <div className="mt-12 flex gap-4">
                  <button className="btn-secondary" onClick={() => {
                    navigator.clipboard.writeText(generatedReport);
                    showToast('Copiado al portapapeles');
                  }}>Copiar Informe</button>
                  <button className="btn-ghost" onClick={handleSaveReport}>Guardar en Proyecto</button>
                  <button className="btn-ghost" onClick={handleGenerateReport}>Regenerar</button>
                </div>
              </motion.div>
            )}

            {!isGenerating && !generatedReport && (
              <div className="flex flex-col items-center justify-center h-full py-12 text-center opacity-30">
                <p className="font-mono text-[10px] uppercase tracking-widest">Presiona el botón para generar el informe con IA.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function ClientesModule({ clientes, setClientes, proyectos, selectedId, setSelectedId, config, showToast }: any) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('TODOS');
  const [isCreating, setIsCreating] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<string | null>(null);

  const filteredClientes = useMemo(() => {
    return clientes.filter((c: any) => {
      const matchesSearch = c.nombre.toLowerCase().includes(search.toLowerCase()) || c.empresa?.toLowerCase().includes(search.toLowerCase());
      const matchesFilter = filter === 'TODOS' || c.estado.toUpperCase() === filter;
      return matchesSearch && matchesFilter;
    });
  }, [clientes, search, filter]);

  const handleAnalyze = async () => {
    setIsAnalyzing(true);
    const systemPrompt = `Eres el asesor comercial de un empresario de servicios. Recibirás el estado de su cartera de clientes y proyectos.
    Responde con exactamente 4 bloques: [SALUD DE CARTERA], [RIESGO INMEDIATO], [OPORTUNIDAD], [ACCIÓN ESTA SEMANA].
    Tono: Profesional, directo, sin rodeos. Máximo 2 oraciones por bloque.`;
    
    const userMessage = `Clientes: ${JSON.stringify(clientes.map((c: any) => ({ nombre: c.nombre, estado: c.estado, valor: c.valorHistorico })))}
    Proyectos Activos: ${JSON.stringify(proyectos.filter((p: any) => p.estado !== 'completado').map((p: any) => ({ nombre: p.nombre, estado: p.estado })))}`;

    const result = await callVortexia(config.apiKey, systemPrompt, userMessage);
    if (result) setAnalysis(result);
    setIsAnalyzing(false);
  };

  if (selectedId) {
    const cliente = clientes.find((c: any) => c.id === selectedId);
    if (!cliente) return null;

    const clienteProyectos = proyectos.filter((p: any) => p.clienteId === cliente.id);

    return (
      <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
        <button onClick={() => setSelectedId(null)} className="btn-ghost mb-8 p-0 flex items-center gap-2">◀ VOLVER</button>
        
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-16">
          <div>
            <h2 className="text-[36px] font-light mb-2">{cliente.nombre}</h2>
            <p className="font-mono text-[12px] text-accent uppercase tracking-[0.2em] mb-8">{cliente.empresa || 'Empresa no registrada'}</p>
            
            <div className="grid grid-cols-2 gap-8 mb-12">
              <div className="p-6 bg-bg-secondary border border-border">
                <p className="font-mono text-[9px] text-text-muted uppercase tracking-widest mb-2">Valor Histórico</p>
                <p className="font-serif text-[24px] text-accent">{formatCurrency(cliente.valorHistorico, config.moneda)}</p>
              </div>
              <div className="p-6 bg-bg-secondary border border-border">
                <p className="font-mono text-[9px] text-text-muted uppercase tracking-widest mb-2">Proyectos Activos</p>
                <p className="font-serif text-[24px]">{clienteProyectos.filter((p: any) => p.estado !== 'completado').length}</p>
              </div>
            </div>

            <div className="space-y-8">
              <div>
                <label className="font-mono text-[9px] text-text-muted uppercase tracking-widest block mb-4">Información de Contacto</label>
                <div className="flex flex-col gap-4">
                  <div className="flex items-center gap-4">
                    <span className="font-mono text-[11px] text-text-muted w-20">EMAIL</span>
                    <span className="text-[16px]">{cliente.email}</span>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="font-mono text-[11px] text-text-muted w-20">INDUSTRIA</span>
                    <span className="text-[16px]">{cliente.industria}</span>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="font-mono text-[11px] text-text-muted w-20">ESTADO</span>
                    <select 
                      value={cliente.estado} 
                      onChange={e => {
                        const updated = clientes.map((c: any) => c.id === cliente.id ? { ...c, estado: e.target.value } : c);
                        setClientes(updated);
                      }}
                      className="bg-transparent border-none p-0 font-mono text-[11px] uppercase tracking-widest text-accent"
                    >
                      <option value="activo">Activo</option>
                      <option value="prospecto">Prospecto</option>
                      <option value="pausado">Pausado</option>
                    </select>
                  </div>
                </div>
              </div>

              <div>
                <label className="font-mono text-[9px] text-text-muted uppercase tracking-widest block mb-4">Notas del Cliente</label>
                <textarea 
                  className="w-full h-32 resize-none"
                  placeholder="Notas internas sobre este cliente..."
                  value={cliente.notas}
                  onChange={e => {
                    const updated = clientes.map((c: any) => c.id === cliente.id ? { ...c, notas: e.target.value } : c);
                    setClientes(updated);
                  }}
                />
              </div>
            </div>
          </div>

          <div>
            <h3 className="font-mono text-[11px] uppercase tracking-[0.3em] mb-8">Proyectos Asociados</h3>
            <div className="space-y-4">
              {clienteProyectos.map((p: any) => (
                <div key={p.id} className="p-6 border border-border bg-bg-secondary flex justify-between items-center">
                  <div>
                    <p className="text-[18px] mb-1">{p.nombre}</p>
                    <p className="font-mono text-[9px] text-text-muted uppercase tracking-widest">{formatDate(p.fechaEntrega)}</p>
                  </div>
                  <span className="font-mono text-[9px] uppercase tracking-widest px-2 py-1 border border-border text-text-muted">
                    {p.estado.replace('_', ' ')}
                  </span>
                </div>
              ))}
              {clienteProyectos.length === 0 && (
                <p className="text-text-muted font-mono text-[11px] uppercase tracking-widest text-center py-12 border border-dashed border-border">Sin proyectos registrados.</p>
              )}
            </div>
          </div>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="flex justify-between items-end mb-12">
        <div>
          <h2 className="text-[48px] font-light mb-4">Clientes</h2>
          <div className="flex gap-8">
            {['TODOS', 'ACTIVOS', 'PROSPECTOS', 'PAUSADOS'].map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`font-mono text-[10px] uppercase tracking-[0.2em] pb-1 border-b transition-all ${filter === f ? 'text-accent border-accent' : 'text-text-muted border-transparent'}`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
        <div className="flex gap-4">
          <button className="btn-secondary" onClick={handleAnalyze}>Analizar Cartera</button>
          <button className="btn-primary" onClick={() => setIsCreating(true)}>Registrar Cliente</button>
        </div>
      </div>

      <div className="mb-8">
        <input 
          type="text" 
          placeholder="Buscar cliente o empresa..." 
          className="w-full bg-bg-secondary border-border"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {isAnalyzing && <div className="golden-loader mb-8" />}
      {analysis && (
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="bg-bg-secondary border-l-2 border-accent p-8 mb-12">
          <div className="flex justify-between items-start mb-4">
            <h3 className="font-mono text-[10px] text-accent uppercase tracking-[0.3em]">Análisis de Cartera</h3>
            <button className="btn-ghost p-0" onClick={() => setAnalysis(null)}>×</button>
          </div>
          <div className="text-[17px] italic leading-relaxed whitespace-pre-wrap">{analysis}</div>
        </motion.div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-border-mid">
              <th className="py-4 font-mono text-[10px] text-text-muted uppercase tracking-widest">Cliente</th>
              <th className="py-4 font-mono text-[10px] text-text-muted uppercase tracking-widest">Estado</th>
              <th className="py-4 font-mono text-[10px] text-text-muted uppercase tracking-widest">Valor Histórico</th>
              <th className="py-4 font-mono text-[10px] text-text-muted uppercase tracking-widest">Último Contacto</th>
            </tr>
          </thead>
          <tbody>
            {filteredClientes.map((c: any) => {
              const daysSince = Math.floor((new Date().getTime() - new Date(c.ultimoContacto).getTime()) / (1000 * 60 * 60 * 24));
              const contactColor = daysSince < 14 ? 'var(--signal-ok)' : daysSince < 30 ? 'var(--signal-warn)' : 'var(--signal-late)';
              
              return (
                <tr key={c.id} className="border-b border-border hover:bg-bg-secondary transition-all cursor-pointer group" onClick={() => setSelectedId(c.id)}>
                  <td className="py-6">
                    <p className="text-[20px] group-hover:text-accent transition-all">{c.nombre}</p>
                    <p className="font-mono text-[10px] text-text-muted uppercase tracking-widest">{c.empresa || c.industria}</p>
                  </td>
                  <td className="py-6">
                    <div className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: c.estado === 'activo' ? 'var(--signal-ok)' : 'var(--text-muted)' }} />
                      <span className="font-mono text-[10px] uppercase tracking-widest">{c.estado}</span>
                    </div>
                  </td>
                  <td className="py-6 font-serif text-[18px] text-accent">{formatCurrency(c.valorHistorico, config.moneda)}</td>
                  <td className="py-6">
                    <span className="font-mono text-[10px] uppercase tracking-widest" style={{ color: contactColor }}>
                      Hace {daysSince} días
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {isCreating && (
        <Modal onClose={() => setIsCreating(false)}>
          <CreateClienteForm 
            onSubmit={(newC: any) => {
              setClientes([...clientes, newC]);
              setIsCreating(false);
              showToast('Cliente registrado');
            }} 
          />
        </Modal>
      )}
    </motion.div>
  );
}

function DocumentosModule({ documentos, setDocumentos, clientes, config, showToast }: any) {
  const [filter, setFilter] = useState('TODOS');
  const [isGenerating, setIsGenerating] = useState<any>(null); // 'CONTRATO' | 'PROPUESTA'
  const [selectedDoc, setSelectedDoc] = useState<any>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const filteredDocs = useMemo(() => {
    if (filter === 'TODOS') return documentos;
    return documentos.filter((d: any) => d.tipo.toUpperCase() === filter.slice(0, -1));
  }, [documentos, filter]);

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="flex justify-between items-end mb-12">
        <div>
          <h2 className="text-[48px] font-light mb-4">Documentos</h2>
          <div className="flex gap-8">
            {['TODOS', 'INFORMES', 'CONTRATOS', 'PROPUESTAS'].map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`font-mono text-[10px] uppercase tracking-[0.2em] pb-1 border-b transition-all ${filter === f ? 'text-accent border-accent' : 'text-text-muted border-transparent'}`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
        <div className="flex gap-4">
          <button className="btn-secondary" onClick={() => setIsGenerating('PROPUESTA')}>Generar Propuesta</button>
          <button className="btn-primary" onClick={() => setIsGenerating('CONTRATO')}>Generar Contrato</button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {filteredDocs.map((doc: any) => (
          <div key={doc.id} className="bg-bg-secondary border border-border p-6 hover:border-border-mid transition-all">
            <div className="flex justify-between items-start mb-4">
              <div>
                <span className="font-mono text-[9px] text-accent uppercase tracking-[0.3em] block mb-1">{doc.tipo}</span>
                <h3 className="text-[20px] font-normal">{doc.clienteNombre}</h3>
              </div>
              <span className="font-mono text-[10px] text-text-muted">{formatDate(doc.creadoEn)}</span>
            </div>
            <p className="text-text-secondary text-[14px] line-clamp-2 mb-6 italic">"{doc.contenido.slice(0, 150)}..."</p>
            <div className="flex gap-4">
              <button className="btn-secondary text-[9px] py-2" onClick={() => {
                navigator.clipboard.writeText(doc.contenido);
                showToast('Copiado');
              }}>Copiar</button>
              <button className="btn-ghost text-[9px]" onClick={() => setSelectedDoc(doc)}>Ver Completo</button>
            </div>
          </div>
        ))}
        {filteredDocs.length === 0 && (
          <div className="col-span-full py-20 text-center border border-dashed border-border">
            <p className="text-text-muted font-mono text-[12px] uppercase tracking-widest">Sin documentos registrados.</p>
          </div>
        )}
      </div>

      {isGenerating && (
        <Modal onClose={() => setIsGenerating(null)}>
          <DocumentGenerator 
            tipo={isGenerating} 
            clientes={clientes} 
            config={config} 
            onSave={(doc: any) => {
              setDocumentos([doc, ...documentos]);
              setIsGenerating(null);
              showToast(`${isGenerating} guardado`);
            }}
          />
        </Modal>
      )}

      {selectedDoc && (
        <Modal onClose={() => setSelectedDoc(null)}>
          <div className="space-y-8">
            <div className="flex justify-between items-start">
              <div>
                <span className="font-mono text-[10px] text-accent uppercase tracking-[0.3em] block mb-2">{selectedDoc.tipo}</span>
                <h3 className="text-[32px] font-light">{selectedDoc.clienteNombre}</h3>
              </div>
              <p className="font-mono text-[11px] text-text-muted">{formatDate(selectedDoc.creadoEn)}</p>
            </div>
            <div className="p-8 border-l-2 border-accent bg-bg-primary font-serif italic text-[17px] leading-relaxed whitespace-pre-wrap">
              {selectedDoc.contenido}
            </div>
            <div className="flex gap-4">
              <button className="btn-primary" onClick={() => {
                navigator.clipboard.writeText(selectedDoc.contenido);
                showToast('Copiado');
              }}>Copiar Contenido</button>
              <button className="btn-secondary" onClick={() => setShowDeleteConfirm(true)}>Eliminar</button>
            </div>
          </div>
        </Modal>
      )}

      {showDeleteConfirm && (
        <Modal onClose={() => setShowDeleteConfirm(false)}>
          <div className="text-center space-y-8">
            <h3 className="text-[24px] font-light">Confirmar Eliminación</h3>
            <p className="text-text-secondary font-mono text-[12px] uppercase tracking-widest leading-relaxed">
              Esta acción es irreversible. El documento será eliminado permanentemente del sistema.
            </p>
            <div className="flex gap-4 justify-center">
              <button className="btn-ghost" onClick={() => setShowDeleteConfirm(false)}>Cancelar</button>
              <button className="btn-primary bg-signal-warn border-signal-warn text-white" onClick={() => {
                setDocumentos(documentos.filter((d: any) => d.id !== selectedDoc.id));
                setSelectedDoc(null);
                setShowDeleteConfirm(false);
                showToast('Documento eliminado');
              }}>Eliminar Permanentemente</button>
            </div>
          </div>
        </Modal>
      )}
    </motion.div>
  );
}

function MetricasModule({ proyectos, clientes, cobros, config, showToast }: any) {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<string | null>(null);

  const stats = useMemo(() => {
    const now = new Date();
    const ingresosMes = cobros
      .filter((c: any) => {
        const d = new Date(c.fecha);
        return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
      })
      .reduce((acc: number, c: any) => acc + (c.monto || 0), 0);

    const activos = proyectos.filter((p: any) => p.estado !== 'completado' && p.estado !== 'pausado');
    const enTiempo = activos.filter((p: any) => p.estado === 'en_tiempo').length;
    const enRiesgo = activos.filter((p: any) => p.estado === 'en_riesgo').length;
    const atrasados = activos.filter((p: any) => p.estado === 'atrasado').length;
    
    const completados = proyectos.filter((p: any) => p.estado === 'completado').length;
    const tasaCumplimiento = proyectos.length > 0 ? Math.round((completados / proyectos.length) * 100) : 100;

    const pipeline = proyectos.reduce((acc: number, p: any) => acc + ((p.valorTotal || 0) - (p.montoRecibido || 0)), 0);
    
    const topCliente = [...clientes].sort((a: any, b: any) => (b.valorHistorico || 0) - (a.valorHistorico || 0))[0];
    
    const proximoVencimiento = [...proyectos]
      .filter((p: any) => p.estado !== 'completado')
      .sort((a: any, b: any) => new Date(a.fechaEntrega).getTime() - new Date(b.fechaEntrega).getTime())[0];

    // Chart Data
    const chartData = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthLabel = d.toLocaleString('es', { month: 'short' }).toUpperCase();
      const total = cobros
        .filter((c: any) => {
          const cd = new Date(c.fecha);
          return cd.getMonth() === d.getMonth() && cd.getFullYear() === d.getFullYear();
        })
        .reduce((acc: number, c: any) => acc + (c.monto || 0), 0);
      chartData.push({ label: monthLabel, value: total });
    }

    return { ingresosMes, activos: activos.length, enTiempo, enRiesgo, atrasados, tasaCumplimiento, pipeline, topCliente, proximoVencimiento, chartData };
  }, [proyectos, clientes, cobros]);

  const handleDiagnose = async () => {
    setIsAnalyzing(true);
    const systemPrompt = `Eres el CFO externo de un empresario de servicios profesionales. Recibirás sus métricas operativas y financieras.
    Responde con exactamente 4 bloques: [POSICIÓN], [RIESGO], [PALANCA], [PROYECCIÓN].
    Tono: Directo, sin suavizar, como alguien que ya vio estas situaciones antes. Máximo 2 oraciones por bloque.`;
    
    const userMessage = `Métricas: ${JSON.stringify(stats)}`;

    const result = await callVortexia(config.apiKey, systemPrompt, userMessage);
    if (result) setAnalysis(result);
    setIsAnalyzing(false);
  };

  const maxChartVal = Math.max(...stats.chartData.map(d => d.value), 1000);

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="flex justify-between items-end mb-12">
        <h2 className="text-[48px] font-light">Métricas</h2>
        <button className="btn-secondary" onClick={handleDiagnose}>Diagnóstico del Negocio</button>
      </div>

      {isAnalyzing && <div className="golden-loader mb-8" />}
      {analysis && (
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="bg-bg-secondary border-l-2 border-accent p-8 mb-12">
          <div className="flex justify-between items-start mb-4">
            <h3 className="font-mono text-[10px] text-accent uppercase tracking-[0.3em]">Diagnóstico Financiero</h3>
            <button className="btn-ghost p-0" onClick={() => setAnalysis(null)}>×</button>
          </div>
          <div className="text-[17px] italic leading-relaxed whitespace-pre-wrap">{analysis}</div>
        </motion.div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 mb-16">
        <MetricCard label="Ingresos del Mes" value={formatCurrency(stats.ingresosMes, config.moneda)} sub="Basado en cobros registrados" accent />
        <MetricCard label="Proyectos Activos" value={stats.activos} sub={`${stats.enTiempo} en tiempo · ${stats.enRiesgo} en riesgo · ${stats.atrasados} atrasados`} />
        <MetricCard 
          label="Tasa de Cumplimiento" 
          value={`${stats.tasaCumplimiento}%`} 
          sub="Proyectos completados vs total" 
          color={stats.tasaCumplimiento < 80 ? 'var(--signal-warn)' : 'var(--text-primary)'}
        />
        <MetricCard label="Valor en Pipeline" value={formatCurrency(stats.pipeline, config.moneda)} sub="Por cobrar" accent />
        <MetricCard label="Cliente más Valioso" value={stats.topCliente?.nombre || '—'} sub={formatCurrency(stats.topCliente?.valorHistorico || 0, config.moneda)} />
        <MetricCard 
          label="Próximo Vencimiento" 
          value={stats.proximoVencimiento?.nombre || '—'} 
          sub={stats.proximoVencimiento ? `${Math.ceil((new Date(stats.proximoVencimiento.fechaEntrega).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24))} días restantes` : 'Sin pendientes'} 
        />
      </div>

      <div className="bg-bg-secondary border border-border p-8">
        <h3 className="font-mono text-[10px] text-text-muted uppercase tracking-[0.3em] mb-8">Ingresos Mensuales (Últimos 6 meses)</h3>
        <div className="h-64 flex items-end gap-4">
          {stats.chartData.map((d, i) => (
            <div key={i} className="flex-1 flex flex-col items-center gap-4">
              <span className="font-mono text-[10px] text-text-muted">{d.value > 0 ? formatCurrency(d.value, config.moneda) : ''}</span>
              <motion.div 
                initial={{ height: 0 }}
                animate={{ height: `${(d.value / maxChartVal) * 100}%` }}
                className={`w-full ${i === 5 ? 'bg-accent' : 'bg-border-mid'}`}
              />
              <span className="font-mono text-[9px] text-text-muted uppercase tracking-widest">{d.label}</span>
            </div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}

function MetricCard({ label, value, sub, accent, color }: any) {
  return (
    <div className="bg-bg-secondary border border-border p-8">
      <p className="font-mono text-[10px] text-text-muted uppercase tracking-[0.2em] mb-4">{label}</p>
      <p className="text-[56px] font-light leading-none mb-4" style={{ color: color || (accent ? 'var(--accent)' : 'var(--text-primary)') }}>{value}</p>
      <p className="font-mono text-[11px] text-text-secondary">{sub}</p>
    </div>
  );
}

// --- FORMS & MODALS ---

function Modal({ children, onClose }: { children: React.ReactNode, onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-8">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} onClick={onClose} className="absolute inset-0 bg-bg-primary/90 backdrop-blur-sm" />
      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="relative bg-bg-secondary border border-border p-12 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <button onClick={onClose} className="absolute top-6 right-6 btn-ghost text-[20px]">×</button>
        {children}
      </motion.div>
    </div>
  );
}

function ConfigForm({ config, onSubmit }: { config: Config, onSubmit: (c: Config) => void }) {
  const [formData, setFormData] = useState({
    nombreEmpresa: config.nombreEmpresa,
    apiKey: config.apiKey,
    moneda: config.moneda
  });

  return (
    <div>
      <h3 className="text-[36px] font-light mb-8">Configuración</h3>
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <label className="font-mono text-[10px] text-text-muted uppercase tracking-widest">Nombre de tu empresa</label>
          <input 
            type="text" 
            placeholder="Ej. Vortexia Studio"
            value={formData.nombreEmpresa}
            onChange={e => setFormData({...formData, nombreEmpresa: e.target.value})}
          />
        </div>
        <div className="flex flex-col gap-2">
          <label className="font-mono text-[10px] text-text-muted uppercase tracking-widest">OpenAI API Key (sk-...)</label>
          <input 
            type="password" 
            placeholder="sk-..."
            value={formData.apiKey}
            onChange={e => setFormData({...formData, apiKey: e.target.value})}
          />
        </div>
        <div className="flex flex-col gap-2">
          <label className="font-mono text-[10px] text-text-muted uppercase tracking-widest">Moneda</label>
          <select 
            value={formData.moneda}
            onChange={e => setFormData({...formData, moneda: e.target.value})}
          >
            <option value="USD">USD — Dólar Estadounidense</option>
            <option value="CLP">CLP — Peso Chileno</option>
            <option value="MXN">MXN — Peso Mexicano</option>
            <option value="EUR">EUR — Euro</option>
            <option value="COP">COP — Peso Colombiano</option>
          </select>
        </div>
        
        <button 
          className="btn-primary w-full mt-4"
          onClick={() => {
            const cleanKey = formData.apiKey.trim().replace(/["']/g, "");
            if (formData.nombreEmpresa && cleanKey.startsWith('sk-')) {
              onSubmit({ ...formData, apiKey: cleanKey });
            } else if (!cleanKey.startsWith('sk-')) {
              alert('La API Key debe empezar por "sk-". Por favor, revísala.');
            }
          }}
        >
          Guardar Cambios
        </button>
      </div>
    </div>
  );
}

function CreateProyectoForm({ clientes, onSubmit }: any) {
  const [data, setData] = useState({
    nombre: '',
    clienteId: clientes[0]?.id || '',
    descripcion: '',
    valorTotal: 0,
    fechaEntrega: ''
  });

  return (
    <div>
      <h3 className="text-[36px] font-light mb-8">Nuevo Proyecto</h3>
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <label className="font-mono text-[10px] text-text-muted uppercase tracking-widest">Nombre del Proyecto</label>
          <input type="text" value={data.nombre} onChange={e => setData({...data, nombre: e.target.value})} />
        </div>
        <div className="flex flex-col gap-2">
          <label className="font-mono text-[10px] text-text-muted uppercase tracking-widest">Cliente</label>
          <select value={data.clienteId} onChange={e => setData({...data, clienteId: e.target.value})}>
            {clientes.map((c: any) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-2">
          <label className="font-mono text-[10px] text-text-muted uppercase tracking-widest">Descripción</label>
          <textarea value={data.descripcion} onChange={e => setData({...data, descripcion: e.target.value})} />
        </div>
        <div className="grid grid-cols-2 gap-6">
          <div className="flex flex-col gap-2">
            <label className="font-mono text-[10px] text-text-muted uppercase tracking-widest">Valor Total</label>
            <input type="number" value={data.valorTotal || 0} onChange={e => setData({...data, valorTotal: parseInt(e.target.value) || 0})} />
          </div>
          <div className="flex flex-col gap-2">
            <label className="font-mono text-[10px] text-text-muted uppercase tracking-widest">Fecha de Entrega</label>
            <input type="date" value={data.fechaEntrega} onChange={e => setData({...data, fechaEntrega: e.target.value})} />
          </div>
        </div>
        <button className="btn-primary w-full mt-4" onClick={() => {
          const cliente = clientes.find((c: any) => c.id === data.clienteId);
          onSubmit({
            ...data,
            id: generateId('PRY'),
            clienteNombre: cliente?.nombre || 'Desconocido',
            estado: 'en_tiempo',
            fechaInicio: new Date().toISOString().split('T')[0],
            avancePorcentaje: 0,
            montoRecibido: 0,
            tareas: [],
            ultimaActualizacion: new Date().toISOString(),
            notas: ''
          });
        }}>Crear Proyecto</button>
      </div>
    </div>
  );
}

function CreateClienteForm({ onSubmit }: any) {
  const [data, setData] = useState({
    nombre: '',
    empresa: '',
    industria: '',
    email: '',
    estado: 'activo'
  });

  return (
    <div>
      <h3 className="text-[36px] font-light mb-8">Registrar Cliente</h3>
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <label className="font-mono text-[10px] text-text-muted uppercase tracking-widest">Nombre Completo</label>
          <input type="text" value={data.nombre} onChange={e => setData({...data, nombre: e.target.value})} />
        </div>
        <div className="flex flex-col gap-2">
          <label className="font-mono text-[10px] text-text-muted uppercase tracking-widest">Empresa</label>
          <input type="text" value={data.empresa} onChange={e => setData({...data, empresa: e.target.value})} />
        </div>
        <div className="flex flex-col gap-2">
          <label className="font-mono text-[10px] text-text-muted uppercase tracking-widest">Industria</label>
          <input type="text" value={data.industria} onChange={e => setData({...data, industria: e.target.value})} />
        </div>
        <div className="flex flex-col gap-2">
          <label className="font-mono text-[10px] text-text-muted uppercase tracking-widest">Email</label>
          <input type="email" value={data.email} onChange={e => setData({...data, email: e.target.value})} />
        </div>
        <button className="btn-primary w-full mt-4" onClick={() => {
          onSubmit({
            ...data,
            id: generateId('CLI'),
            valorHistorico: 0,
            proyectosActivos: 0,
            ultimoContacto: new Date().toISOString(),
            notas: ''
          });
        }}>Registrar Cliente</button>
      </div>
    </div>
  );
}

function DocumentGenerator({ tipo, clientes, config, onSave }: any) {
  const [step, setStep] = useState(1);
  const [isGenerating, setIsGenerating] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [formData, setFormData] = useState<any>({
    clienteId: clientes[0]?.id || '',
    servicio: '',
    monto: 0,
    duracion: '',
    entregables: '',
    problema: ''
  });

  const handleGenerate = async () => {
    setIsGenerating(true);
    const cliente = clientes.find((c: any) => c.id === formData.clienteId);
    
    let systemPrompt = '';
    let userMessage = '';

    if (tipo === 'CONTRATO') {
      systemPrompt = `Eres un abogado comercial especializado en contratos de servicios profesionales y tecnología. Genera un contrato de prestación de servicios profesional y completo. Tono: legal pero legible. Deja espacios marcados con [___] para los datos que faltan.`;
      userMessage = `Cliente: ${cliente.nombre}, Empresa: ${cliente.empresa}, Servicio: ${formData.servicio}, Monto: ${formData.monto}, Duración: ${formData.duracion}, Entregables: ${formData.entregables}`;
    } else {
      systemPrompt = `Eres el director comercial de una agencia de soluciones tecnológicas para empresarios. Creas propuestas que cierran tratos. Tono: confiado, directo. Sin frases de cierre agresivas.`;
      userMessage = `Cliente: ${cliente.nombre}, Servicio: ${formData.servicio}, Problema: ${formData.problema}, Inversión: ${formData.monto}, Plazo: ${formData.duracion}`;
    }

    const output = await callVortexia(config.apiKey, systemPrompt, userMessage, 1500);
    if (output) {
      setResult(output);
      setStep(2);
    }
    setIsGenerating(false);
  };

  return (
    <div>
      <h3 className="text-[36px] font-light mb-8">Generar {tipo}</h3>
      
      {step === 1 && (
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <label className="font-mono text-[10px] text-text-muted uppercase tracking-widest">Cliente</label>
            <select value={formData.clienteId} onChange={e => setFormData({...formData, clienteId: e.target.value})}>
              {clientes.map((c: any) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-2">
            <label className="font-mono text-[10px] text-text-muted uppercase tracking-widest">Servicio</label>
            <input type="text" value={formData.servicio} onChange={e => setFormData({...formData, servicio: e.target.value})} />
          </div>
          {tipo === 'PROPUESTA' && (
            <div className="flex flex-col gap-2">
              <label className="font-mono text-[10px] text-text-muted uppercase tracking-widest">Problema que resuelve</label>
              <textarea value={formData.problema} onChange={e => setFormData({...formData, problema: e.target.value})} />
            </div>
          )}
          <div className="grid grid-cols-2 gap-6">
            <div className="flex flex-col gap-2">
              <label className="font-mono text-[10px] text-text-muted uppercase tracking-widest">Inversión / Monto</label>
              <input type="number" value={formData.monto || 0} onChange={e => setFormData({...formData, monto: parseInt(e.target.value) || 0})} />
            </div>
            <div className="flex flex-col gap-2">
              <label className="font-mono text-[10px] text-text-muted uppercase tracking-widest">Plazo / Duración</label>
              <input type="text" value={formData.duracion} onChange={e => setFormData({...formData, duracion: e.target.value})} />
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <label className="font-mono text-[10px] text-text-muted uppercase tracking-widest">Entregables Principales</label>
            <textarea value={formData.entregables} onChange={e => setFormData({...formData, entregables: e.target.value})} />
          </div>
          
          <button className="btn-primary w-full mt-4" onClick={handleGenerate} disabled={isGenerating}>
            {isGenerating ? 'Generando...' : `Generar ${tipo}`}
          </button>
          {isGenerating && <div className="golden-loader mt-4" />}
        </div>
      )}

      {step === 2 && result && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          <div className="border-l-2 border-accent pl-8 mb-12">
            <Typewriter text={result} speed={5} />
          </div>
          <div className="flex gap-4">
            <button className="btn-primary" onClick={() => {
              const cliente = clientes.find((c: any) => c.id === formData.clienteId);
              onSave({
                id: generateId('DOC'),
                tipo: tipo.toLowerCase(),
                clienteId: formData.clienteId,
                clienteNombre: cliente.nombre,
                contenido: result,
                creadoEn: new Date().toISOString()
              });
            }}>Guardar Documento</button>
            <button className="btn-secondary" onClick={() => navigator.clipboard.writeText(result)}>Copiar</button>
            <button className="btn-ghost" onClick={() => setStep(1)}>Editar Datos</button>
          </div>
        </motion.div>
      )}
    </div>
  );
}
