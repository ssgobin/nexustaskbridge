import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getAuth, signInWithEmailAndPassword } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import {
  getFirestore, collection, addDoc, onSnapshot, query, orderBy,
  serverTimestamp, doc, getDocs, updateDoc
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

// Mesma base do Nexus (ajuste se vocês mudarem de projeto Firebase)
const firebaseConfig = {
  apiKey: 'AIzaSyA7l0LovQnLdv9obeR3YSH6MTdR2d6xcug',
  authDomain: 'hubacia-407c1.firebaseapp.com',
  projectId: 'hubacia-407c1',
  storageBucket: 'hubacia-407c1.appspot.app',
  messagingSenderId: '633355141941',
  appId: '1:633355141941:web:e65270fdabe95da64cc27c',
  measurementId: 'G-LN9BEKHCD5'
};

const FIXED_SOLICITANTE = 'Adolpho';
const NEXUS_BOARD = 'PROJETOS';

const el = {
  form: document.getElementById('taskForm'),
  title: document.getElementById('fTitle'),
  task: document.getElementById('fTask'),
  desc: document.getElementById('fDesc'),
  resp: document.getElementById('fResp'),
  status: document.getElementById('fStatus'),
  requestAt: document.getElementById('fRequestAt'),
  due: document.getElementById('fDue'),
  doneAt: document.getElementById('fDoneAt'),
  obs: document.getElementById('fObs'),
  msg: document.getElementById('formMsg'),
  btnSave: document.getElementById('btnSave'),
  btnClear: document.getElementById('btnClear'),
  list: document.getElementById('taskList'),
  q: document.getElementById('qSearch'),
  badge: document.getElementById('cloudBadge'),
  refresh: document.getElementById('btnRefresh')
};

let db;
let auth;
let allRows = [];
let usersCache = [];

const AUTO_LOGIN_EMAIL = 'ti@acia.com.br';
const AUTO_LOGIN_PASSWORD = 'J@123456';

function nowLocalInput() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}
function toIsoOrNull(v) { return v ? new Date(v).toISOString() : null; }
function toPt(v) { return v ? new Date(v).toLocaleString('pt-BR') : '—'; }
function escapeHtml(s = '') {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function setMsg(type, text) {
  el.msg.className = `msg ${type || ''}`.trim();
  el.msg.textContent = text || '';
  if (text) {
    el.msg.style.animation = 'none';
    setTimeout(() => {
      el.msg.style.animation = 'slideInUp 0.3s ease-out';
    }, 10);
  }
}

function buildNexusDesc({ acoes, objetivo, info }) {
  const a = (acoes || '').trim();
  const o = (objetivo || '').trim();
  const i = (info || '').trim();
  return `TAREFA QUE DEVE SER FEITA
${a || 'Descrever todas as ações que devem ser aplicadas para a execução e entrega da tarefa, com excelência.'}

OBJETIVO DA TAREFA
${o || 'Descrever qual é a razão da execução desta tarefa e qual o resultado esperado.'}

INFORMAÇÕES ADICIONAIS
${i || 'Listar todas as informações pertinentes que contribuam para a ação mais efetiva e assertiva em sua execução.'}`;
}

function setLoading(v) {
  el.btnSave.disabled = v;
  const icon = v ? '<i class="fas fa-spinner fa-spin"></i>' : '<i class="fas fa-save"></i>';
  const text = v ? 'Salvando tarefa…' : 'Salvar + criar card no Nexus';
  el.btnSave.innerHTML = `<span class="btn-icon">${icon}</span><span>${text}</span>`;
}

async function init() {
  try {
    const app = initializeApp(firebaseConfig);
    auth = getAuth(app);

    // Login automático para cumprir as regras do Firestore (@acia.com.br)
    await signInWithEmailAndPassword(auth, AUTO_LOGIN_EMAIL, AUTO_LOGIN_PASSWORD);

    db = getFirestore(app);
    el.badge.className = 'pill ok';
    el.badge.innerHTML = '<span class="pill-icon"><i class="fas fa-check"></i></span><span>Firebase conectado</span>';

    el.requestAt.value = nowLocalInput();
    const plus1h = new Date(Date.now() + 3600_000);
    plus1h.setMinutes(plus1h.getMinutes() - plus1h.getTimezoneOffset());
    el.due.value = plus1h.toISOString().slice(0, 16);

    await loadUsers();
    startTasksListener();
    startCardsSyncListener();
    bindEvents();
  } catch (err) {
    console.error(err);
    el.badge.className = 'pill err';
    el.badge.innerHTML = '<span class="pill-icon"><i class="fas fa-times"></i></span><span>Falha no Firebase</span>';
    setMsg('err', `<i class="fas fa-exclamation-circle"></i> Não foi possível conectar no Firebase. ${err?.message || 'Confira config/regras/autenticação.'}`);
  }
}

async function loadUsers() {
  try {
    const q = query(collection(db, 'users'), orderBy('name', 'asc'));
    const snap = await getDocs(q);
    const users = [];
    snap.forEach(d => {
      const u = d.data() || {};
      if (u.placeholder) return;
      const uid = u.uid || d.id;
      const label = u.name || u.email || uid;
      users.push({ uid, label });
    });
    usersCache = users;
    if (!users.length) {
      el.resp.innerHTML = '<option value="">Nenhum usuário encontrado</option>';
      return;
    }
    el.resp.innerHTML = users.map(u => `<option value="${u.uid}" data-label="${escapeHtml(u.label)}">${escapeHtml(u.label)}</option>`).join('');
  } catch (e) {
    console.error(e);
    el.resp.innerHTML = '<option value="">Erro ao carregar usuários</option>';
  }
}

function startTasksListener() {
  const qRef = query(collection(db, 'nexus_tasks_bridge'), orderBy('createdAt', 'desc'));
  onSnapshot(qRef, (snap) => {
    allRows = [];
    snap.forEach(d => allRows.push({ id: d.id, ...d.data() }));
    renderList();
  }, (e) => {
    console.error(e);
    setMsg('err', 'Erro ao ouvir tarefas em tempo real.');
  });
}


function startCardsSyncListener() {
  onSnapshot(collection(db, 'cards'), async (snap) => {
    const ops = [];
    snap.forEach(cardDoc => {
      const c = cardDoc.data() || {};
      if (c.source !== 'bridge_nexus_tasks') return;
      const bridge = allRows.find(r => r.nexusCardId === cardDoc.id);
      if (!bridge) return;

      const cardStatus = c.status || bridge.status || 'PENDENTE';
      const cardFinish = c.finishAt || null;

      const bridgeStatus = bridge.status || '';
      const bridgeFinish = bridge.dataConclusao || null;

      const changedStatus = bridgeStatus !== cardStatus;
      const changedFinish = (bridgeFinish || null) !== (cardFinish || null);

      if (!changedStatus && !changedFinish) return;

      const payload = {
        status: cardStatus,
        updatedAt: serverTimestamp()
      };
      if (cardStatus === 'CONCLUÍDO' || cardFinish) {
        payload.dataConclusao = cardFinish || new Date().toISOString();
      } else {
        payload.dataConclusao = null;
      }

      ops.push(updateDoc(doc(db, 'nexus_tasks_bridge', bridge.id), payload));
    });

    if (ops.length) {
      try {
        await Promise.all(ops);
      } catch (e) {
        console.error('Erro sincronizando conclusão/status com cards do Nexus', e);
      }
    }
  }, (e) => {
    console.error(e);
  });
}

function bindEvents() {
  el.form.addEventListener('submit', onSubmit);
  el.btnClear.addEventListener('click', () => {
    el.form.reset();
    el.requestAt.value = nowLocalInput();
    el.doneAt.value = "";
    setMsg('', '');
  });
  el.q.addEventListener('input', renderList);
  el.refresh.addEventListener('click', async () => {
    el.refresh.style.animation = 'spin 0.5s ease-in-out';
    await loadUsers();
    renderList();
    setTimeout(() => {
      el.refresh.style.animation = '';
    }, 500);
  });
}

async function onSubmit(ev) {
  ev.preventDefault();
  setMsg('', '');

  const respUid = el.resp.value || null;
  const respLabel = el.resp.selectedOptions[0]?.dataset?.label || el.resp.selectedOptions[0]?.textContent || '';
  if (!respUid) return setMsg('err', 'Selecione um responsável.');

  const titulo = (el.title.value || '').trim();
  const objetivo = (el.task.value || '').trim();
  const descrever = (el.desc.value || '').trim();
  if (!titulo) return setMsg('err', 'Preencha o título.');
  if (!objetivo) return setMsg('err', 'Preencha o objetivo da tarefa.');
  if (!descrever) return setMsg('err', 'Preencha o campo Descrever a tarefa.');

  const status = (el.status.value || 'PENDENTE').trim();
  const doneAtIso = null; // controlado automaticamente pelo card no Nexus
  const requestAtIso = toIsoOrNull(el.requestAt.value) || new Date().toISOString();
  const dueIso = toIsoOrNull(el.due.value);
  if (!dueIso) return setMsg('err', 'Informe o prazo de entrega.');

  const bridgeRecord = {
    titulo,
    objetivoTarefa: objetivo,
    tarefa: objetivo,
    descritivo: descrever,
    responsavel: respLabel,
    responsavelUid: respUid,
    dataSolicitacao: requestAtIso,
    prazoEntrega: dueIso,
    status,
    dataConclusao: doneAtIso,
    obs: el.obs.value.trim(),
    solicitante: FIXED_SOLICITANTE,
    origem: 'bridge_nexus_tasks',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    nexusCardId: null
  };

  // payload compatível com cards do Nexus
  const nexusCard = {
    title: bridgeRecord.titulo,
    desc: buildNexusDesc({
      acoes: bridgeRecord.descritivo,
      objetivo: bridgeRecord.objetivoTarefa,
      info: bridgeRecord.obs
    }),
    board: NEXUS_BOARD,
    status: bridgeRecord.status,
    solicitante: FIXED_SOLICITANTE,
    resp: bridgeRecord.responsavel,
    respUid: bridgeRecord.responsavelUid,
    due: bridgeRecord.prazoEntrega,
    finishAt: bridgeRecord.dataConclusao,
    requestAt: bridgeRecord.dataSolicitacao,
    obs: bridgeRecord.obs,
    source: 'bridge_nexus_tasks',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  setLoading(true);
  try {
    const bridgeRef = await addDoc(collection(db, 'nexus_tasks_bridge'), bridgeRecord);
    const cardRef = await addDoc(collection(db, 'cards'), nexusCard);

    await updateDoc(doc(db, 'nexus_tasks_bridge', bridgeRef.id), {
      nexusCardId: cardRef.id,
      updatedAt: serverTimestamp()
    });

    await addDoc(collection(db, 'nexus_tasks_bridge_links'), {
      bridgeTaskId: bridgeRef.id,
      nexusCardId: cardRef.id,
      createdAt: serverTimestamp()
    });

    setMsg('ok', `<i class="fas fa-check-circle"></i> Tarefa salva com sucesso! Card criado no Nexus (ID: ${cardRef.id})`);
    el.form.reset();
    el.requestAt.value = nowLocalInput();
    el.doneAt.value = "";
    // Auto-scroll para a lista de tarefas em telas pequenas
    if (window.innerWidth <= 1024) {
      setTimeout(() => {
        document.querySelector('.list-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 300);
    }
  } catch (err) {
    console.error(err);
    setMsg('err', `<i class="fas fa-exclamation-triangle"></i> Erro ao salvar tarefa: ${err?.message || err}`);
  } finally {
    setLoading(false);
  }
}

function renderList() {
  const q = (el.q.value || '').trim().toLowerCase();
  const rows = allRows.filter(r => {
    if (!q) return true;
    const bag = [r.titulo, r.tarefa, r.objetivoTarefa, r.responsavel, r.status, r.descritivo, r.obs].join(' ').toLowerCase();
    return bag.includes(q);
  });

  if (!rows.length) {
    const emptyMsg = q ? '<i class="fas fa-search"></i> Nenhuma tarefa encontrada para sua busca' : '<i class="fas fa-inbox"></i> Nenhuma tarefa cadastrada ainda';
    el.list.innerHTML = `<div class="empty">${emptyMsg}</div>`;
    return;
  }

  el.list.innerHTML = rows.map((r, idx) => {
    const statusClass = r.status === 'CONCLUÍDO' ? 'ok' : (new Date(r.prazoEntrega || 0) < new Date() ? 'err' : 'warn');
    const statusIcon = r.status === 'CONCLUÍDO' ? '<i class="fas fa-check-circle"></i>' : (r.status === 'EXECUÇÃO' ? '<i class="fas fa-cog fa-spin"></i>' : (r.status === 'PENDENTE' ? '<i class="fas fa-hourglass-half"></i>' : '<i class="fas fa-clipboard"></i>'));
    return `
      <div class="task-item" style="animation-delay: ${idx * 0.05}s">
        <div class="title"><i class="fas fa-thumbtack"></i> ${escapeHtml(r.titulo || r.tarefa || '(sem título)')}</div>
        <div class="meta">
          <span><i class="fas fa-user"></i> ${escapeHtml(r.responsavel || '—')}</span>
          <span><i class="fas fa-user-tie"></i> ${escapeHtml(r.solicitante || FIXED_SOLICITANTE)}</span>
          <span><i class="far fa-calendar-plus"></i> ${toPt(r.dataSolicitacao)}</span>
          <span><i class="far fa-clock"></i> ${toPt(r.prazoEntrega)}</span>
          ${r.dataConclusao ? `<span><i class="fas fa-check-circle"></i> ${toPt(r.dataConclusao)}</span>` : ''}
        </div>
        <div class="badges">
          <span class="pill ${statusClass}">${statusIcon} ${escapeHtml(r.status || '—')}</span>
          ${r.nexusCardId ? `<span class="pill" title="ID do card no Nexus"><i class="fas fa-link"></i> Card: ${escapeHtml(r.nexusCardId.substring(0, 8))}...</span>` : ''}
        </div>
        ${r.objetivoTarefa ? `<div class="desc"><strong><i class="fas fa-bullseye"></i> Objetivo:</strong> ${escapeHtml(r.objetivoTarefa)}</div>` : ''}
        ${r.descritivo ? `<div class="desc"><strong><i class="fas fa-file-alt"></i> Descrição:</strong> ${escapeHtml(r.descritivo)}</div>` : ''}
        ${r.obs ? `<div class="obs"><strong><i class="fas fa-comment"></i> Observações:</strong> ${escapeHtml(r.obs)}</div>` : ''}
      </div>
    `;
  }).join('');
}

init();
