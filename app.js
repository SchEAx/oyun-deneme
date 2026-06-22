const SUPABASE_URL = 'https://cgcdsvbdkubntmrqutxl.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNnY2RzdmJka3VibnRtcnF1dHhsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIxMjIxNTQsImV4cCI6MjA5NzY5ODE1NH0.1QUhjyJyC9cm5vNpP3zDPhXHdUEb5xc9bicRPrLg-Rs';
const money = new Intl.NumberFormat('tr-TR', { style:'currency', currency:'TRY' });
const todayISO = new Date().toISOString().slice(0,10);
const currentMonth = todayISO.slice(0,7);
const $ = id => document.getElementById(id);
let sb = null;
let state = { people: [], advances: [], deductions: [] };

function showToast(text){ const t=$('toast'); t.textContent=text; t.classList.add('show'); setTimeout(()=>t.classList.remove('show'),3200); }
function parseNum(v){ return Math.max(0, Number(String(v||'').replace(',','.')) || 0); }
function monthOf(date){ return String(date||'').slice(0,7); }
function monthLabel(m){ const [y,mo]=String(m).split('-'); return `${mo}.${y}`; }
function getPerson(id){ return state.people.find(p=>p.id===id); }
function deductionsOf(advanceId){ return state.deductions.filter(d=>d.advance_id===advanceId); }
function paidOf(advance){ return deductionsOf(advance.id).reduce((s,d)=>s+Number(d.amount||0),0); }
function remainingOf(advance){ return Math.max(0, Number(advance.amount||0)-paidOf(advance)); }
function advancesFor(personId){ return state.advances.filter(a=>a.person_id===personId).sort((a,b)=>String(a.advance_date).localeCompare(String(b.advance_date))); }
function payTypeText(p){ return (p.pay_type||'monthly') === 'weekly' ? 'Haftalık' : 'Aylık'; }
function payDayText(p){ return (p.pay_type||'monthly') === 'weekly' ? weekDayName(p.salary_weekday ?? 1) : `Her ayın ${p.salary_day || 1}. günü`; }
function weekDayName(v){ return ['Pazar','Pazartesi','Salı','Çarşamba','Perşembe','Cuma','Cumartesi'][Number(v)||0]; }
function dueToday(p){
  const now = new Date();
  if((p.pay_type||'monthly') === 'weekly') return now.getDay() === Number(p.salary_weekday ?? 1);
  return now.getDate() === Number(p.salary_day || 1);
}
function duePeople(){ return state.people.filter(p=>dueToday(p)); }

function initSupabase(){
  sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  const setup = $('setupCard');
  if(setup) setup.classList.add('hidden');
  return true;
}
async function loadAll(){
  if(!sb) return;
  showToast('Veriler çekiliyor...');

  const p = await sb.from('avans_personel').select('*').order('name', { ascending:true });
  if(p.error){ console.error('avans_personel okuma hatası:', p.error); showToast('Personel listesi okunamadı: ' + (p.error.message || 'policy/SQL hatası')); return; }
  state.people = p.data || [];

  const a = await sb.from('avans_kayitlari').select('*').order('advance_date', { ascending:true });
  if(a.error){ console.error('avans_kayitlari okuma hatası:', a.error); showToast('Avans kayıtları okunamadı: ' + (a.error.message || 'policy/SQL hatası')); state.advances = []; } else state.advances = a.data || [];

  const d = await sb.from('avans_kesintileri').select('*').order('created_at', { ascending:true });
  if(d.error){ console.error('avans_kesintileri okuma hatası:', d.error); showToast('Kesinti kayıtları okunamadı: ' + (d.error.message || 'policy/SQL hatası')); state.deductions = []; } else state.deductions = d.data || [];

  renderAll();
  scheduleSalaryReminder();
  showToast(`${state.people.length} personel yüklendi.`);
}
function fillPersonSelects(){
  ['advancePerson','historyPerson','salaryPerson'].forEach(id=>{
    const el=$(id), old=el.value; el.innerHTML='';
    if(!state.people.length){ el.innerHTML='<option value="">Önce personel ekle</option>'; return; }
    state.people.forEach(p=>{ const o=document.createElement('option'); o.value=p.id; o.textContent=p.name; el.appendChild(o); });
    if(state.people.some(p=>p.id===old)) el.value=old;
  });
}
function summaryHTML(items){ return items.map(([label,value,type])=>`<div class="summary ${type||''}"><span>${label}</span><b>${type==='count' ? (value||0) : money.format(value||0)}</b></div>`).join(''); }
function renderGlobalSummary(){
  const total = state.advances.reduce((s,a)=>s+Number(a.amount||0),0);
  const paid = state.deductions.reduce((s,d)=>s+Number(d.amount||0),0);
  const open = Math.max(0,total-paid);
  $('globalSummary').innerHTML = summaryHTML([['Toplam Avans',total],['Toplam Kesilen',paid,'ok'],['Açık Avans',open,'danger'],['Personel',state.people.length,'count']]);
  renderDueBox();
}
function renderDueBox(){
  const box = $('dueBox'); if(!box) return;
  const list = duePeople();
  if(!list.length){ box.innerHTML = '<span class="badge ok">Bugün maaş günü olan personel yok</span>'; return; }
  box.innerHTML = `<span class="badge warn">Bugün maaş günü: ${list.map(p=>p.name).join(', ')}</span>`;
}
function renderPeople(){
  const box=$('personList'); box.innerHTML='';
  state.people.forEach(p=>{
    const div=document.createElement('div'); div.className='mini-item';
    div.innerHTML=`<div><b>${p.name}</b><span>Maaş: ${money.format(p.salary||0)} • ${payTypeText(p)} • ${payDayText(p)}</span></div>`;
    const btns=document.createElement('div');
    const edit=document.createElement('button'); edit.className='small ghost'; edit.textContent='Düzenle'; edit.onclick=()=>{
      $('personName').value=p.name; $('personSalary').value=p.salary||0; $('personPayType').value=p.pay_type||'monthly'; $('personSalaryDay').value=p.salary_day||1; $('personSalaryWeekday').value=p.salary_weekday ?? 1; $('personName').dataset.editId=p.id; togglePayFields(); document.querySelector('[data-tab="tabPeople"]').click();
    };
    const del=document.createElement('button'); del.className='small danger'; del.textContent='Sil'; del.onclick=()=>deletePerson(p.id);
    btns.append(edit,del); div.append(btns); box.append(div);
  });
  if(!state.people.length) box.innerHTML='<p class="hint">Henüz personel yok.</p>';
}
function renderHistory(){
  const personId=$('historyPerson').value, month=$('historyMonth').value||currentMonth, body=$('historyBody'); body.innerHTML='';
  const list=advancesFor(personId).filter(a=>monthOf(a.advance_date)<=month && (remainingOf(a)>0 || monthOf(a.advance_date)===month));
  let total=0, paid=0, rem=0, carried=0;
  list.forEach(a=>{
    const p=paidOf(a), r=remainingOf(a); total+=Number(a.amount||0); paid+=p; rem+=r; if(monthOf(a.advance_date)<month && r>0) carried+=r;
    const status = r<=0 ? '<span class="badge ok">Kapandı</span>' : monthOf(a.advance_date)<month ? '<span class="badge warn">Devreden</span>' : '<span class="badge open">Açık</span>';
    const tr=document.createElement('tr'); tr.innerHTML=`<td>${a.advance_date}</td><td>${a.note||'-'}</td><td>${money.format(a.amount)}</td><td>${money.format(p)}</td><td>${money.format(r)}</td><td>${status}</td>`; body.append(tr);
  });
  if(!list.length) body.innerHTML='<tr><td colspan="6">Bu ay için avans kaydı veya devreden bakiye yok.</td></tr>';
  $('historySummary').innerHTML=summaryHTML([['Toplam Avans',total],['Kesilen',paid,'ok'],['Kalan',rem,'danger'],['Geçmişten Devreden',carried,'warn']]);
}
function renderSalary(){
  const personId=$('salaryPerson').value, month=$('salaryMonth').value||currentMonth, body=$('deductionBody'); body.innerHTML='';
  const list=advancesFor(personId).filter(a=>monthOf(a.advance_date)<=month && (remainingOf(a)>0 || deductionsOf(a.id).some(d=>d.deduction_month===month)));
  list.forEach(a=>{
    const current=deductionsOf(a.id).filter(d=>d.deduction_month===month).reduce((s,d)=>s+Number(d.amount||0),0);
    const remaining = remainingOf(a) + current;
    const tr=document.createElement('tr');
    tr.innerHTML=`<td><input type="checkbox" class="deduct-check" data-id="${a.id}" ${current>0?'checked':''}></td><td>${a.advance_date}</td><td>${a.note||'-'}</td><td>${money.format(a.amount)}</td><td>${money.format(remaining)}</td><td><input type="number" min="0" max="${remaining}" step="0.01" class="deduct-amount" data-id="${a.id}" value="${current||''}" placeholder="0"></td>`;
    body.append(tr);
  });
  if(!list.length) body.innerHTML='<tr><td colspan="6">Kesilecek açık avans yok.</td></tr>';
  document.querySelectorAll('.deduct-amount').forEach(i=>i.addEventListener('input', renderSalaryCardsOnly));
  document.querySelectorAll('.deduct-check').forEach(c=>c.addEventListener('change', e=>{ const input=document.querySelector(`.deduct-amount[data-id="${e.target.dataset.id}"]`); if(!e.target.checked) input.value=''; renderSalaryCardsOnly(); }));
  renderSalaryCardsOnly();
}
function renderSalaryCardsOnly(){
  const person=getPerson($('salaryPerson').value), salary=Number(person?.salary||0), personId=$('salaryPerson').value, month=$('salaryMonth').value||currentMonth;
  const totalOpen=advancesFor(personId).filter(a=>monthOf(a.advance_date)<=month).reduce((s,a)=>s+remainingOf(a),0);
  const planned=Array.from(document.querySelectorAll('.deduct-amount')).reduce((s,input)=>{ const checked=document.querySelector(`.deduct-check[data-id="${input.dataset.id}"]`)?.checked; return s+(checked?parseNum(input.value):0); },0);
  $('salaryCards').innerHTML=summaryHTML([['Maaş',salary],['Açık Avans',totalOpen,'danger'],['Bu Ay Kesilecek',planned,'warn'],['Alacağı Maaş',Math.max(0,salary-planned),'ok']]);
}
function renderAll(){ fillPersonSelects(); renderGlobalSummary(); renderPeople(); renderHistory(); renderSalary(); }
async function savePerson(){
  const name=$('personName').value.trim(), salary=parseNum($('personSalary').value), editId=$('personName').dataset.editId;
  const pay_type=$('personPayType').value || 'monthly';
  const salary_day = pay_type === 'monthly' ? Number($('personSalaryDay').value || 1) : null;
  const salary_weekday = pay_type === 'weekly' ? Number($('personSalaryWeekday').value ?? 1) : null;
  if(!name) return showToast('Personel adı gir knk.');
  const data={ name, salary, pay_type, salary_day, salary_weekday };
  const res = editId ? await sb.from('avans_personel').update(data).eq('id',editId).select().single() : await sb.from('avans_personel').insert(data).select().single();
  if(res.error){ console.error('Personel kayıt hatası:', res.error); return showToast('Personel kaydedilemedi: ' + (res.error.message || '')); }
  $('personName').value=''; $('personSalary').value=''; $('personPayType').value='monthly'; $('personSalaryDay').value=15; $('personSalaryWeekday').value=1; delete $('personName').dataset.editId; togglePayFields();
  await loadAll(); document.querySelector('[data-tab="tabPeople"]').click(); showToast('Personel kaydedildi ve liste yenilendi.');
}
async function deletePerson(id){
  if(state.advances.some(a=>a.person_id===id)) return showToast('Bu personelde avans kaydı var, silinmedi.');
  const res=await sb.from('avans_personel').delete().eq('id',id); if(res.error) return showToast('Personel silinemedi.'); await loadAll(); showToast('Personel silindi.');
}
async function saveAdvance(){
  const person_id=$('advancePerson').value, amount=parseNum($('advanceAmount').value), note=$('advanceNote').value.trim(), advance_date=$('advanceDate').value||todayISO;
  if(!person_id) return showToast('Personel seç knk.'); if(amount<=0) return showToast('Avans miktarı gir knk.');
  const res=await sb.from('avans_kayitlari').insert({ person_id, amount, note, advance_date });
  if(res.error){ console.error(res.error); return showToast('Avans kaydedilemedi.'); }
  $('advanceAmount').value=''; $('advanceNote').value=''; $('advanceDate').value=todayISO; await loadAll(); showToast('Avans kaydı eklendi.');
}
async function applyDeductions(){
  const month=$('salaryMonth').value||currentMonth;
  const rows=Array.from(document.querySelectorAll('.deduct-amount'));
  const payload=[]; const deletes=[];
  for(const input of rows){
    const id=input.dataset.id, checked=document.querySelector(`.deduct-check[data-id="${id}"]`)?.checked, amount=checked?parseNum(input.value):0;
    const adv=state.advances.find(a=>a.id===id); if(!adv) continue;
    const current=deductionsOf(id).filter(d=>d.deduction_month===month).reduce((s,d)=>s+Number(d.amount||0),0);
    const max=remainingOf(adv)+current;
    if(amount>max+0.001) return showToast(`${adv.note||adv.advance_date} için kalan tutardan fazla kesinti var.`);
    if(amount>0) payload.push({ advance_id:id, deduction_month:month, amount }); else deletes.push(id);
  }
  if(deletes.length){ const del=await sb.from('avans_kesintileri').delete().in('advance_id',deletes).eq('deduction_month',month); if(del.error) return showToast('Eski kesinti silinemedi.'); }
  if(payload.length){ const up=await sb.from('avans_kesintileri').upsert(payload, { onConflict:'advance_id,deduction_month' }); if(up.error){ console.error(up.error); return showToast('Kesinti kaydedilemedi.'); } }
  await loadAll(); showToast(`${monthLabel(month)} kesintileri kaydedildi.`);
}
function togglePayFields(){
  const type = $('personPayType').value;
  $('monthlyField').classList.toggle('hidden', type !== 'monthly');
  $('weeklyField').classList.toggle('hidden', type !== 'weekly');
}
async function requestNotifications(){
  if(!('Notification' in window)) return showToast('Bu tarayıcı bildirim desteklemiyor.');
  const perm = await Notification.requestPermission();
  if(perm === 'granted'){ localStorage.setItem('garage_avans_notifications','1'); showToast('Bildirim izni verildi.'); scheduleSalaryReminder(true); }
  else showToast('Bildirim izni verilmedi.');
}
function notificationAlreadySentKey(){ return `garage_avans_salary_notified_${todayISO}`; }
function shouldNotifyNow(){ const h=new Date().getHours(); return h>=9 && h<=10 && localStorage.getItem('garage_avans_notifications')==='1' && localStorage.getItem(notificationAlreadySentKey())!=='1'; }
async function showSalaryNotification(force=false){
  const list = duePeople();
  if(!list.length) return;
  if(!force && !shouldNotifyNow()) return;
  const title = 'Garage İstanbul Avans Takip';
  const body = `Bugün maaş günü olan personel: ${list.map(p=>p.name).join(', ')}`;
  try{
    const reg = await navigator.serviceWorker?.getRegistration?.();
    if(reg?.showNotification) await reg.showNotification(title, { body, icon:'icon-192.png', badge:'icon-192.png', tag:'garage-avans-maas' });
    else if('Notification' in window && Notification.permission === 'granted') new Notification(title, { body, icon:'icon-192.png' });
    localStorage.setItem(notificationAlreadySentKey(),'1');
  }catch(e){ console.warn(e); }
}
function scheduleSalaryReminder(force=false){
  renderDueBox();
  if(force) showSalaryNotification(true);
  showSalaryNotification(false);
}
function bind(){
  $('todayText').textContent=`Bugün: ${todayISO}`; $('advanceDate').value=todayISO; $('historyMonth').value=currentMonth; $('salaryMonth').value=currentMonth;
  document.querySelectorAll('.tab-btn').forEach(btn=>btn.addEventListener('click',()=>{ document.querySelectorAll('.tab-btn,.tab-panel').forEach(x=>x.classList.remove('active')); btn.classList.add('active'); $(btn.dataset.tab).classList.add('active'); renderAll(); }));
  $('syncBtn').onclick=loadAll; $('savePersonBtn').onclick=savePerson; $('saveAdvanceBtn').onclick=saveAdvance; $('applyDeductionBtn').onclick=applyDeductions; $('notifyBtn').onclick=requestNotifications; $('personPayType').onchange=togglePayFields;
  ['historyPerson','historyMonth'].forEach(id=>$(id).addEventListener('change',renderHistory)); ['salaryPerson','salaryMonth'].forEach(id=>$(id).addEventListener('change',renderSalary));
  togglePayFields();
  setInterval(()=>scheduleSalaryReminder(false), 10*60*1000);
}
if('serviceWorker' in navigator){ window.addEventListener('load',()=>navigator.serviceWorker.register('sw.js?v=4').catch(()=>{})); }
bind(); if(initSupabase()) loadAll();
