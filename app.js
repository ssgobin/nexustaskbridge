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
function escapeHtml(s='') {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function setMsg(type, text) {
  el.msg.className = `msg ${type || ''}`.trim();
  el.msg.textContent = text || '';
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
  el.btnSave.textContent = v ? 'Salvando…' : 'Salvar + criar card no Nexus';
}

async function init() {
  try {
    const app = initializeApp(firebaseConfig);
    auth = getAuth(app);

    // Login automático para cumprir as regras do Firestore (@acia.com.br)
    await signInWithEmailAndPassword(auth, AUTO_LOGIN_EMAIL, AUTO_LOGIN_PASSWORD);

    db = getFirestore(app);
    el.badge.className = 'pill ok';
    el.badge.textContent = 'Firebase conectado';

    el.requestAt.value = nowLocalInput();
    const plus1h = new Date(Date.now() + 3600_000);
    plus1h.setMinutes(plus1h.getMinutes() - plus1h.getTimezoneOffset());
    el.due.value = plus1h.toISOString().slice(0,16);

    await loadUsers();
    startTasksListener();
    startCardsSyncListener();
    bindEvents();
  } catch (err) {
    console.error(err);
    el.badge.className = 'pill err';
    el.badge.textContent = 'Falha no Firebase';
    setMsg('err', `Não foi possível conectar no Firebase. ${err?.message || 'Confira config/regras/autenticação.'}`);
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
    await loadUsers();
    renderList();
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

    setMsg('ok', `Tarefa salva e card criado no Nexus (card: ${cardRef.id}).`);
    el.form.reset();
    el.requestAt.value = nowLocalInput();
    el.doneAt.value = "";
  } catch (err) {
    console.error(err);
    setMsg('err', `Erro ao salvar: ${err?.message || err}`);
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
    el.list.innerHTML = '<div class="empty">Nenhuma tarefa encontrada</div>';
    return;
  }

  el.list.innerHTML = rows.map(r => {
    const statusClass = r.status === 'CONCLUÍDO' ? 'ok' : (new Date(r.prazoEntrega || 0) < new Date() ? 'err' : 'warn');
    return `
      <div class="task-item">
        <div class="title">${escapeHtml(r.titulo || r.tarefa || '(sem título)')}</div>
        <div class="meta">
          <span><strong>Resp:</strong> ${escapeHtml(r.responsavel || '—')}</span>
          <span><strong>Solicitante:</strong> ${escapeHtml(r.solicitante || FIXED_SOLICITANTE)}</span>
          <span><strong>Solicitação:</strong> ${toPt(r.dataSolicitacao)}</span>
          <span><strong>Prazo:</strong> ${toPt(r.prazoEntrega)}</span>
          <span><strong>Conclusão:</strong> ${toPt(r.dataConclusao)}</span>
        </div>
        <div class="badges">
          <span class="pill ${statusClass}">${escapeHtml(r.status || '—')}</span>
          ${r.nexusCardId ? `<span class="pill">Card Nexus: ${escapeHtml(r.nexusCardId)}</span>` : ''}
        </div>
        ${r.objetivoTarefa ? `<div class="desc"><strong>Objetivo:</strong> ${escapeHtml(r.objetivoTarefa)}</div>` : ''}
        ${r.descritivo ? `<div class="desc"><strong>Descrever:</strong> ${escapeHtml(r.descritivo)}</div>` : ''}
        ${r.obs ? `<div class="obs"><strong>Informações adicionais / OBS:</strong> ${escapeHtml(r.obs)}</div>` : ''}
      </div>
    `;
  }).join('');
}

init();
