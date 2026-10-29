const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const tls = require('node:tls');

// Antivirus HTTPS scanning (Norton, Avast, Kaspersky…) re-signs traffic with a root that only
// Windows trusts; without the system store every call to the D&D API fails with
// UNABLE_TO_VERIFY_LEAF_SIGNATURE.
try { if (tls.setDefaultCACertificates && tls.getCACertificates) tls.setDefaultCACertificates([...new Set([...tls.getCACertificates('default'), ...tls.getCACertificates('system')])]); } catch (err) { console.warn('Certificados do sistema indisponíveis:', err.message); }

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const DATA_DIR = path.resolve(process.env.CRONICAS_DATA_DIR || path.join(ROOT, 'data'));
const MAP_DIR = path.join(DATA_DIR, 'maps');
const MEDIA_DIR = path.join(DATA_DIR, 'media');
const PORTRAIT_DIR = path.join(DATA_DIR, 'portraits');
const STATE_FILE = path.join(DATA_DIR, 'campaign.json');
const CAMPAIGNS_DIR = path.join(DATA_DIR, 'campaigns');
const CAMPAIGNS_INDEX = path.join(DATA_DIR, 'campaign-index.json');
const SRD_ORIGIN = 'https://www.dnd5eapi.co';
const SRD_CACHE_DIR = path.join(DATA_DIR, 'srd-cache');
const SRD_IMAGE_DIR = path.join(SRD_CACHE_DIR, 'images');
const SRD_FRESH_MS = 7 * 24 * 3600 * 1000;
const PORT = Number(process.env.PORT || 3040);
const HOST = process.env.HOST || '0.0.0.0';
fs.mkdirSync(SRD_IMAGE_DIR, { recursive: true });
fs.mkdirSync(MAP_DIR, { recursive: true });
fs.mkdirSync(MEDIA_DIR, { recursive: true });
fs.mkdirSync(PORTRAIT_DIR, { recursive: true });
fs.mkdirSync(CAMPAIGNS_DIR, { recursive: true });

function defaultSheet() {
  return {
    identity: { name:'', className:'', level:1, subclass:'', ancestry:'', background:'', alignment:'', playerName:'', xp:'', portraitUrl:'' },
    abilities: { str:10,dex:10,con:10,int:10,wis:10,cha:10 }, saves:[], skills:[],
    combat: { proficiency:2, initiative:0, speed:'9 m', inspiration:0, hitDice:'', spellcastingAbility:'', spellSaveDc:'', spellAttackBonus:'' },
    hp: { max:10,current:10,temp:0 }, ac:10, defenses:'', actions:'', conditions:'', proficiencies:'',
    deathSaves:{successes:[false,false,false],failures:[false,false,false]},
    attacks:Array.from({length:6},()=>({name:'',hit:'',damage:'',notes:''})),
    inventory:Array.from({length:12},()=>({name:'',quantity:'',weight:'',notes:''})),
    currency:{cp:'0',sp:'0',ep:'0',gp:'0',pp:'0'}, carrying:{weight:'',encumbered:'',lift:''},
    features:'', appearance:{gender:'',age:'',size:'',height:'',weight:'',eyes:'',hair:'',skin:'',faith:'',allies:'',description:''},
    history:{story:'',personality:'',ideals:'',bonds:'',flaws:'',notes:'',extras:''},
    spellcasting:{ability:'',saveDc:'',attackBonus:'',notes:'',slots:{}},
    spells:Array.from({length:17},()=>({prepared:false,name:'',source:'',save:'',time:'',range:'',components:'',duration:'',level:'',notes:''}))
  };
}
function legacyCharacterToSheet(c) {
  const sheet=defaultSheet();
  Object.assign(sheet.identity,{name:c.name||'',className:c.class||'',level:Number(c.level)||1,subclass:c.subclass||'',ancestry:c.race||'',background:c.background||'',alignment:c.alignment||'',playerName:c.player_name||'',xp:c.xp||'',portraitUrl:c.portrait||''});
  for(const [newKey,oldKey] of Object.entries({str:'força',dex:'destreza',con:'constituição',int:'inteligência',wis:'sabedoria',cha:'carisma'}))sheet.abilities[newKey]=Number(c.abilities?.[oldKey]??c.abilities?.[newKey]??c.abilities?.[{str:'for',dex:'des',con:'con',int:'int',wis:'sab',cha:'car'}[newKey]]??10);
  sheet.saves=Array.isArray(c.saves)?c.saves:[];sheet.skills=Array.isArray(c.skills)?c.skills:[];
  Object.assign(sheet.combat,{proficiency:Number(c.proficiency_bonus)||2,initiative:Number.parseInt(c.initiative,10)||0,speed:c.speed||'9 m',inspiration:Number(c.inspiration)||0,hitDice:c.hit_dice||'',spellcastingAbility:c.spellcasting_ability||'',spellSaveDc:c.spell_save_dc||'',spellAttackBonus:c.spell_attack_bonus||''});
  Object.assign(sheet.hp,{max:Number(c.max_hp)||Number(c.hp)||10,current:Number(c.hp)||10,temp:Number(c.temp_hp)||0});sheet.ac=Number(c.ac)||10;sheet.defenses=c.defenses||'';sheet.actions=c.actions||'';sheet.conditions=c.conditions||'';sheet.proficiencies=c.proficiencies||'';sheet.features=c.features||'';
  sheet.deathSaves=c.death_saves||sheet.deathSaves;
  for(let i=0;i<6;i++)for(const key of ['name','hit','damage','notes'])sheet.attacks[i][key]=c[`attack_${key}_${i+1}`]||'';
  if(!sheet.attacks.some(a=>a.name)&&c.attacks)sheet.attacks[0].name=String(c.attacks).slice(0,100);
  for(let i=0;i<12;i++)for(const key of ['name','quantity','weight','notes'])sheet.inventory[i][key]=c[`equipment_${({quantity:'qty'})[key]||key}_${i+1}`]||'';
  sheet.currency={cp:c.cp||'0',sp:c.sp||'0',ep:c.ep||'0',gp:c.gp||'0',pp:c.pp||'0'};sheet.carrying={weight:c.weight_carried||'',encumbered:c.encumbered||'',lift:c.push_drag_lift||''};
  sheet.history={story:c.background_details||'',personality:c.personality_traits||'',ideals:c.ideals||'',bonds:c.bonds||'',flaws:c.flaws||'',notes:c.notes||'',extras:c.extras||c.equipment||''};
  sheet.appearance={gender:c.gender||'',age:c.age||'',size:c.size||'',height:c.height||'',weight:c.body_weight||'',eyes:c.eyes||'',hair:c.hair||'',skin:c.skin||'',faith:c.faith||'',allies:c.allies||'',description:c.appearance||''};
  sheet.spellcasting={ability:c.spellcasting_ability||'',saveDc:c.spell_save_dc||'',attackBonus:c.spell_attack_bonus||'',notes:c.spells||'',slots:{}};
  for(let i=0;i<17;i++){const n=i+1;Object.assign(sheet.spells[i],{prepared:['✓','true','1'].includes(String(c[`spell_prepared_${n}`]).toLowerCase()),name:c[`spell_name_${n}`]||'',source:c[`spell_source_${n}`]||'',save:c[`spell_save_${n}`]||'',time:c[`spell_time_${n}`]||'',range:c[`spell_range_${n}`]||'',components:c[`spell_components_${n}`]||'',duration:c[`spell_duration_${n}`]||'',level:c[`spell_page_ref_${n}`]||'',notes:c[`spell_notes_${n}`]||''});}
  return mergeDefaults(defaultSheet(),sheet);
}

function newState() {
  return {
    version: 1,
    campaign: { name: 'Nova campanha', chapter: 'Capítulo I', mode: 'normal', round: 1, activeTurn: 0 },
    players: Array.from({ length: 6 }, (_, i) => ({ id: i + 1, name: `Player ${i + 1}`, character: '', ancestry: '', className: '', level: 1, hp: 10, maxHp: 10, ac: 10, initiative: 0, effects: [], stats: { for: 10, des: 10, con: 10, int: 10, sab: 10, car: 10 }, sheet:defaultSheet(), visible: true })),
    monsters: [], bosses: [], map: { url: '', name: '', visible: false, annotationsVisible:true, grid: true, gridSize: 48, tokens: {}, annotations: [] },
    battle:{audioUrl:'',audioName:'',volume:70}, log: [], rolls: [], updatedAt: new Date().toISOString()
  };
}
// --- SRD (dnd5eapi.co) with on-disk cache so the table keeps working offline ---
const SRD_QUERIES={
  monsters:'monsters(limit:1000){ index name type size challenge_rating hit_points image }',
  spells:'spells(limit:1000){ index name level school{name} classes{name} }',
  'magic-items':'magicItems(limit:1000){ index name rarity{name} equipment_category{name} }',
  equipment:'equipments(limit:1000){ __typename ... on IEquipment { index name weight cost{quantity unit} } ... on Weapon { weapon_category damage{ damage_dice } } ... on Armor { armor_category armor_class{ base } } }',
  conditions:'conditions{ index name }'
};
const SRD_FIELD={monsters:'monsters',spells:'spells','magic-items':'magicItems',equipment:'equipments',conditions:'conditions'};
function srdCacheFile(key){return path.join(SRD_CACHE_DIR,`${crypto.createHash('sha1').update(key).digest('hex')}.json`);}
async function srdCached(key,loader){
  const file=srdCacheFile(key);let cached=null;
  try{cached=JSON.parse(fs.readFileSync(file,'utf8'));}catch{}
  if(cached&&Date.now()-cached.at<SRD_FRESH_MS)return cached.data;
  try{const data=await loader();writeJsonAtomic(file,{at:Date.now(),data});return data;}
  catch(err){if(cached)return cached.data;throw err;}
}
async function srdFetchJson(url,init={}){
  const response=await fetch(url,{...init,headers:{Accept:'application/json','User-Agent':'CronicasDnD/2.1',...(init.headers||{})},signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw new Error(`A API D&D 5e respondeu ${response.status}.`);
  return response.json();
}
function srdSummary(kind,item){
  const url=`/api/2014/${kind}/${item.index}`;
  if(kind==='monsters')return{index:item.index,name:item.name,url,cr:item.challenge_rating,type:item.type,size:item.size,hp:item.hit_points,image:item.image?`/srd-images/${item.image.replace(/^\/api\/images\//,'')}`:''};
  if(kind==='spells')return{index:item.index,name:item.name,url,level:item.level,school:item.school?.name||'',classes:(item.classes||[]).map(c=>c.name)};
  if(kind==='magic-items')return{index:item.index,name:item.name,url,rarity:item.rarity?.name||'',category:item.equipment_category?.name||''};
  if(kind==='equipment')return{index:item.index,name:item.name,url,category:item.__typename||'',weight:item.weight??'',cost:item.cost?`${item.cost.quantity} ${item.cost.unit}`:'',damage:item.damage?.damage_dice||'',weaponCategory:item.weapon_category||'',ac:item.armor_class?.base??''};
  return{index:item.index,name:item.name,url};
}
async function srdCatalog(kind){
  return srdCached(`catalog:${kind}`,async()=>{
    const payload=await srdFetchJson(`${SRD_ORIGIN}/graphql/2014`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query:`{ ${SRD_QUERIES[kind]} }`})});
    if(payload.errors?.length)throw new Error(payload.errors[0].message);
    return (payload.data?.[SRD_FIELD[kind]]||[]).filter(x=>x?.index).map(x=>srdSummary(kind,x)).sort((a,b)=>a.name.localeCompare(b.name));
  });
}
async function srdImage(relative){
  if(!/^[\w-]+\/[\w.-]+\.(png|jpe?g|webp)$/i.test(relative))throw new Error('Imagem inválida.');
  const file=path.join(SRD_IMAGE_DIR,relative.replace('/','__'));
  if(!fs.existsSync(file)){
    const response=await fetch(`${SRD_ORIGIN}/api/images/${relative}`,{signal:AbortSignal.timeout(20000)});
    if(!response.ok)throw new Error(`Imagem indisponível (${response.status}).`);
    fs.writeFileSync(file,Buffer.from(await response.arrayBuffer()));
  }
  return file;
}

let campaigns=[];
try { campaigns=JSON.parse(fs.readFileSync(CAMPAIGNS_INDEX,'utf8')); if(!Array.isArray(campaigns))campaigns=[]; } catch { campaigns=[]; }
function mergeDefaults(base, saved) {
  for (const [key,value] of Object.entries(base)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) saved[key]=mergeDefaults(value, saved[key]&&typeof saved[key]==='object'?saved[key]:{});
    else if (saved[key] === undefined) saved[key]=structuredClone(value);
  }
  return saved;
}

let state;
function writeJsonAtomic(filename, value) {
  const temp = `${filename}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2));
  fs.renameSync(temp, filename);
}
// One server per data folder: two instances on different ports would silently
// clobber each other's campaign.json (each keeps its own diverging in-memory state).
const lockFile = path.join(DATA_DIR, '.lock');
const removeLock = () => { try { fs.unlinkSync(lockFile); } catch {} };
try { fs.closeSync(fs.openSync(lockFile, 'wx')); }
catch (err) {
  if (err.code === 'EEXIST') {
    // A stale lock (crash, power loss) must not lock the user out forever:
    // it holds the PID of the previous run, so only refuse if that PID is alive.
    let stale = false;
    try { const pid = Number.parseInt(fs.readFileSync(lockFile, 'utf8'), 10); stale = !Number.isInteger(pid) || Number(pid) <= 0 || !(pid => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } })(pid); } catch { stale = true; }
    if (stale) { try { fs.unlinkSync(lockFile); } catch {} try { fs.closeSync(fs.openSync(lockFile, 'wx')); } catch { console.error('Outra instância do Crónicas Web já está a usar esta pasta de dados.'); process.exit(1); } }
    else { console.error('Outra instância do Crónicas Web já está a usar esta pasta de dados.'); process.exit(1); }
  } else { console.error('Não foi possível abrir a pasta de dados:', err.message); process.exit(1); }
}
try { fs.writeFileSync(lockFile, String(process.pid)); } catch {}
process.on('exit', removeLock);
// Without these handlers, Ctrl+C kills Node without running 'exit', leaving a stale lock.
process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
for (const dir of [DATA_DIR, CAMPAIGNS_DIR]) { try { for (const f of fs.readdirSync(dir)) if (f.endsWith('.tmp')) { try { fs.unlinkSync(path.join(dir, f)); } catch {} } } catch {} }
try {
  state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  if (!Array.isArray(state.players) || state.players.length !== 6) throw new Error('invalid save');
} catch (err) {
  if (fs.existsSync(STATE_FILE)) { try { fs.renameSync(STATE_FILE, `${STATE_FILE}.bad-${Date.now()}`); } catch {} console.error(`campaign.json ilegível (${err.message}); cópia guardada como campaign.json.bad-*.`); }
  state = newState(); persist();
}
function emptyMap(name='',url='') { return {id:crypto.randomUUID(),url,name,visible:false,annotationsVisible:true,grid:true,gridSize:48,tokens:{},annotations:[]}; }
function normalizeMap(m) {
  m.id ||= crypto.randomUUID(); m.tokens ||= {}; m.annotations ||= [];
  if(m.annotationsVisible===undefined)m.annotationsVisible=true; if(m.grid===undefined)m.grid=true; m.gridSize ||= 48;
  return m;
}
// state.map is the active scene; state.maps is the scene library and holds the same object,
// so edits to the active map are kept when the DM switches scenes.
function normalizeCampaign(s) {
  s.campaign ||= {name:'Nova campanha',chapter:'Capítulo I',mode:'normal',round:1,activeTurn:0};
  s.campaign.turnOrder ||= [];
  s.battle ||= {audioUrl:'',audioName:'',volume:70};
  s.map=normalizeMap(s.map||emptyMap());
  s.maps=(Array.isArray(s.maps)?s.maps:[]).map(normalizeMap);
  const index=s.maps.findIndex(m=>m.id===s.map.id);
  if(index>=0)s.maps[index]=s.map; else if(s.map.url)s.maps.unshift(s.map);
  s.monsters ||= []; s.bosses ||= []; s.rolls ||= []; s.log ||= [];
  for (const p of s.players) {
    p.sheet=mergeDefaults(defaultSheet(),p.sheet||{});
    p.sheet.identity.name ||= p.character||''; p.sheet.identity.className ||= p.className||''; p.sheet.identity.ancestry ||= p.ancestry||''; p.sheet.identity.level ||= p.level||1;
    p.sheet.hp.current = p.hp ?? p.sheet.hp.current; p.sheet.hp.max = p.maxHp ?? p.sheet.hp.max; p.sheet.ac = p.ac ?? p.sheet.ac;
  }
  return s;
}
normalizeCampaign(state);
state.campaignId ||= crypto.randomUUID();
if(!campaigns.some(c=>c.id===state.campaignId))campaigns.push({id:state.campaignId,name:state.campaign?.name||'Campanha',updatedAt:state.updatedAt||new Date().toISOString()});
const initialCampaignFile=path.join(CAMPAIGNS_DIR,`${state.campaignId}.json`);
if(!fs.existsSync(initialCampaignFile))fs.writeFileSync(initialCampaignFile,JSON.stringify(state,null,2));
writeJsonAtomic(CAMPAIGNS_INDEX,campaigns);
persist();saveCampaignSnapshot();
const clients = new Set();
function persist() {
  state.updatedAt = new Date().toISOString();
  writeJsonAtomic(STATE_FILE,state);
}
function addLog(text, type = 'note', refs = null) {
  state.log.unshift({ id: crypto.randomUUID(), text: String(text ?? '').slice(0, 500), type, at: new Date().toISOString(), ...(refs && refs.length ? { refs } : {}) });
  state.log = state.log.slice(0, 250);
}
function saveCampaignIndex() {
  const entry=campaigns.find(c=>c.id===state.campaignId);
  if(entry){entry.name=state.campaign?.name||entry.name;entry.updatedAt=state.updatedAt||new Date().toISOString();}
  writeJsonAtomic(CAMPAIGNS_INDEX,campaigns);
}
function saveCampaignSnapshot() {
  writeJsonAtomic(path.join(CAMPAIGNS_DIR,`${state.campaignId}.json`),state);
  saveCampaignIndex();
}
function switchCampaign(id) {
  if(!/^[\w-]+$/.test(String(id))||!campaigns.some(c=>c.id===id))throw new Error('Campanha não encontrada.');
  persist();saveCampaignSnapshot();
  const snapshot=JSON.parse(fs.readFileSync(path.join(CAMPAIGNS_DIR,`${id}.json`),'utf8'));
  state=normalizeCampaign(snapshot);
}
function findActor(kind,id) {
  if(kind==='player')return state.players.find(p=>p.id===Number(id));
  return (kind==='boss'?state.bosses:state.monsters).find(e=>e.id===id);
}
// p.hp/p.maxHp/p.ac are the live values the DM's heal/damage actions change;
// mirror them into the sheet so a player's next full-sheet autosave can't revert them.
function syncPlayerSheet(p) { p.sheet.hp.current = p.hp; p.sheet.hp.max = p.maxHp; p.sheet.ac = p.ac; }
// A log/roll entry tagged with refs is only public while every referenced actor is visible.
function visibleActor(a) {
  if (!a || !a.kind) return false;
  if (a.kind === 'player') return state.players.some(p => p.id === Number(a.id) && p.visible !== false);
  return (a.kind === 'boss' ? state.bosses : state.monsters).some(e => e.id === a.id && e.visible !== false);
}
function entryVisible(entry) { if (!Array.isArray(entry?.refs) || !entry.refs.length) return true; return entry.refs.every(visibleActor); }
function rollInitiative() {
  const actors=[...state.players.filter(p=>p.visible!==false).map(p=>({kind:'player',id:p.id,name:p.character||p.name,bonus:Number(p.sheet?.combat?.initiative)||Number(p.initiative)||0,actor:p})),...state.monsters.map(e=>({kind:'monster',id:e.id,name:e.name,bonus:Number(e.initiative)||0,actor:e})),...state.bosses.map(e=>({kind:'boss',id:e.id,name:e.name,bonus:Number(e.initiative)||0,actor:e}))];
  for(const entry of actors){const die=crypto.randomInt(1,21),total=die+entry.bonus;entry.total=total;state.rolls.unshift({id:crypto.randomUUID(),who:entry.name,sourceKind:entry.kind,entityId:entry.id,sides:20,count:1,bonus:entry.bonus,dice:[die],total,public:true,at:new Date().toISOString(),refs:[{kind:entry.kind,id:entry.id}]});}
  state.rolls=state.rolls.slice(0,200);actors.sort((a,b)=>b.total-a.total||b.bonus-a.bonus);
  state.campaign.turnOrder=actors.map(a=>({kind:a.kind,id:a.id,name:a.name,initiative:a.total}));state.campaign.activeTurn=0;state.campaign.round=1;state.campaign.activeName=state.campaign.turnOrder[0]?.name||'';
  addLog(`Iniciativa: ${state.campaign.turnOrder.map(a=>`${a.name} ${a.initiative}`).join(' · ')}`,'public', [...state.monsters, ...state.bosses].filter(e => e.visible === false).map(e => ({ kind: state.bosses.includes(e) ? 'boss' : 'monster', id: e.id })));
}
function pruneActor(kind,id) {
  const key=`${kind}:${id}`;for(const m of state.maps)delete m.tokens[key];delete state.map.tokens[key];
  const order=state.campaign.turnOrder||[];const index=order.findIndex(a=>a.kind===kind&&String(a.id)===String(id));
  if(index>=0){order.splice(index,1);if(state.campaign.activeTurn>index||state.campaign.activeTurn>=order.length)state.campaign.activeTurn=Math.max(0,Math.min(order.length-1,state.campaign.activeTurn-1));state.campaign.activeName=order[state.campaign.activeTurn]?.name||'';}
}
function publicState(role = 'projector', playerId = 0) {
  const copy = structuredClone(state);
  if (role === 'player') {
    copy.players = copy.players.filter(p => p.id === playerId || p.visible !== false).map(p => p.id === playerId ? ({ ...p, visible: true }) : ({ id:p.id,name:p.name,character:p.character,ancestry:p.ancestry,className:p.className,level:p.level,hp:p.hp,maxHp:p.maxHp,ac:p.ac,initiative:p.initiative,effects:p.effects,portrait:p.sheet?.identity?.portraitUrl||'',visible:true }));
    copy.monsters = copy.monsters.filter(e => e.visible !== false); copy.bosses = copy.bosses.filter(e => e.visible !== false);
    copy.log = copy.log.filter(x => x.type === 'public' && entryVisible(x)).slice(0, 40);
    copy.rolls = copy.rolls.filter(x => x.public && entryVisible(x)).slice(0, 40);
    const publicIds=new Set([...copy.monsters,...copy.bosses].map(e=>e.id));
    const publicPlayers=new Set(copy.players.map(p=>String(p.id)));
    copy.map.tokens = Object.fromEntries(Object.entries(copy.map.tokens || {}).filter(([key]) => key.startsWith('player:') ? publicPlayers.has(key.slice(7)) : publicIds.has(key.split(':').slice(1).join(':'))));
  } else if (role === 'projector') {
    copy.players = copy.players.filter(p => p.visible !== false).map(p => ({ id: p.id, name: p.name, character: p.character, hp: p.hp, maxHp: p.maxHp, effects: p.effects, portrait:p.sheet?.identity?.portraitUrl||'', visible: p.visible }));
    copy.monsters = copy.monsters.filter(e => e.visible !== false); copy.bosses = copy.bosses.filter(e => e.visible !== false);
    copy.log = copy.log.filter(x => x.type === 'public' && entryVisible(x)).slice(0, 30);
    copy.rolls = copy.rolls.filter(x => x.public && entryVisible(x)).slice(0, 30);
    copy.battle = {audioUrl:copy.battle?.audioUrl||'',audioName:copy.battle?.audioName||'',volume:copy.battle?.volume??70};
    const publicIds=new Set([...copy.monsters,...copy.bosses].map(e=>e.id));
    const publicPlayers=new Set(copy.players.map(p=>String(p.id)));
    copy.map.tokens = Object.fromEntries(Object.entries(copy.map.tokens || {}).filter(([key]) => key.startsWith('player:') ? publicPlayers.has(key.slice(7)) : publicIds.has(key.split(':').slice(1).join(':'))));
  }
  if(role==='dm'){copy.campaigns=campaigns.map(({id,name,updatedAt})=>({id,name,updatedAt}));copy.maps=state.maps.map(({id,name,url,visible})=>({id,name,url,visible}));}
  else {
    delete copy.campaigns; delete copy.maps;
    copy.log=copy.log.map(({refs,...rest})=>rest); copy.rolls=copy.rolls.map(({refs,...rest})=>rest);
    if(Array.isArray(copy.campaign.turnOrder)){const order=copy.campaign.turnOrder,visibleOrder=order.filter(visibleActor);if(visibleOrder.length!==order.length){const active=order[copy.campaign.activeTurn];copy.campaign.turnOrder=visibleOrder;copy.campaign.activeTurn=Math.max(0,visibleOrder.indexOf(active));copy.campaign.activeName=visibleOrder[copy.campaign.activeTurn]?.name||'';}}
    if(state.map.visible!==true){copy.map.url='';copy.map.name='';copy.map.tokens={};copy.map.annotations=[];}
  }
  if(role!=='dm'&&copy.map.annotationsVisible===false)copy.map.annotations=[];
  return copy;
}
function broadcast() {
  for (const client of clients) {
    try {
      if (client.res.destroyed || client.res.writableEnded) { clients.delete(client); continue; }
      client.res.write(`event: state\ndata: ${JSON.stringify(publicState(client.role, client.playerId))}\n\n`);
    } catch { clients.delete(client); }
  }
}
setInterval(() => { for (const client of clients) { try { client.res.write(': ping\n\n'); } catch { clients.delete(client); } } }, 25000).unref();
let snapshotTimer = null;
function flushSnapshot() { snapshotTimer = null; try { saveCampaignSnapshot(); } catch (err) { console.error('Snapshot write failed:', err.message); } }
function saveAndBroadcast() { persist(); if (!snapshotTimer) snapshotTimer = setTimeout(flushSnapshot, 4000); broadcast(); }
process.on('exit', () => { if (snapshotTimer) flushSnapshot(); });
function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
}
function readBody(req, limit = 24 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let data = ''; req.setEncoding('utf8');
    req.on('data', chunk => { data += chunk; if (data.length > limit) { reject(new Error('Pedido demasiado grande.')); req.destroy(); } });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { reject(new Error('JSON inválido.')); } });
    req.on('error', reject);
  });
}
function safeMapPath(file) {
  const resolved = path.resolve(MAP_DIR, file);
  if (!resolved.startsWith(MAP_DIR + path.sep)) throw new Error('Ficheiro inválido.');
  return resolved;
}
// All file routes stream through this: an EISDIR/EBUSY/ENOENT on the read must never
// become an uncaught exception (fs.exists guard can't cover AV/backup file locks on Windows).
function streamFile(res, file, headers) {
  const stream = fs.createReadStream(file);
  stream.on('error', () => { try { if (res.headersSent) res.end(); else send(res, 404, { error: 'Não encontrado.' }); } catch {} try { res.destroy(); } catch {} });
  res.writeHead(200, headers);
  stream.pipe(res);
}
function action(body, role, playerId) {
  const { type } = body;
  if (role === 'projector') throw new Error('A vista de projetor é apenas de leitura.');
  const requireDm = () => { if (role !== 'dm') throw new Error('Só o DM pode alterar esta área.'); };
  const log = (text, isPublic = true, kind = 'note', refs = null) => addLog(text, isPublic ? 'public' : kind, refs);
  switch (type) {
    case 'create-campaign': {
      requireDm();persist();saveCampaignSnapshot();const id=crypto.randomUUID();const name=String(body.name||'Nova campanha').trim().slice(0,100)||'Nova campanha';state=normalizeCampaign(newState());state.campaignId=id;state.campaign.name=name;campaigns.push({id,name,updatedAt:new Date().toISOString()});addLog(`Campanha criada: ${name}.`);break;
    }
    case 'switch-campaign': {
      requireDm();const id=String(body.id||'');if(id!==state.campaignId){switchCampaign(id);addLog(`Campanha ativa: ${state.campaign.name}.`);}break;
    }
    case 'delete-campaign': {
      requireDm();if(campaigns.length<=1)throw new Error('A última campanha não pode ser removida.');const id=String(body.id||state.campaignId);if(!campaigns.some(c=>c.id===id))throw new Error('Campanha não encontrada.');if(id===state.campaignId){const next=campaigns.find(c=>c.id!==id);switchCampaign(next.id);}campaigns=campaigns.filter(c=>c.id!==id);const file=path.join(CAMPAIGNS_DIR,`${id}.json`);if(fs.existsSync(file))fs.unlinkSync(file);log('Campanha removida.');break;
    }
    case 'update-campaign': requireDm(); { const patch = body.patch || {}; for (const k of ['name', 'chapter']) if (Object.hasOwn(patch, k)) state.campaign[k] = String(patch[k] ?? '').slice(0, 120); log(`Campanha atualizada: ${state.campaign.name}.`); } break;
    case 'update-player': {
      const id = role === 'dm' ? Number(body.id) : playerId;
      const p = state.players.find(x => x.id === id); if (!p) throw new Error('Jogador não encontrado.');
      const patch = body.patch || {};
      const allowed = role === 'dm' ? ['name','character','ancestry','className','level','hp','maxHp','ac','initiative','effects','stats','sheet','visible'] : ['character','ancestry','className','level','hp','maxHp','ac','initiative','stats','sheet'];
      const numOr = (v, fb) => { if (v === '' || v == null) return fb; const n = Number(v); return Number.isFinite(n) ? n : fb; };
      for (const k of allowed) if (Object.hasOwn(patch, k)) p[k] = patch[k];
      if (patch.sheet) {
        p.character = patch.sheet.identity?.name ?? p.character; p.ancestry = patch.sheet.identity?.ancestry ?? p.ancestry;
        p.className = patch.sheet.identity?.className ?? p.className; p.level = numOr(patch.sheet.identity?.level, p.level);
        p.maxHp = numOr(patch.sheet.hp?.max, p.maxHp); p.hp = numOr(patch.sheet.hp?.current, p.hp); p.ac = numOr(patch.sheet.ac, p.ac);
        p.initiative = numOr(patch.sheet.combat?.initiative, p.initiative);
      }
      p.maxHp = Math.max(1, numOr(p.maxHp, 10)); p.hp = Math.max(0, Math.min(numOr(p.hp, 0), p.maxHp)); p.ac = numOr(p.ac, 10);
      syncPlayerSheet(p);
      log(`${p.character || p.name} atualizou a ficha.`, true, 'note', [{ kind: 'player', id: p.id }]); break;
    }
    case 'toggle-player-visibility': {
      requireDm(); const p=state.players.find(x=>x.id===Number(body.id)); if(!p)throw new Error('Jogador não encontrado.');
      p.visible=body.visible!==false; log(`${p.character||p.name} ${p.visible?'visível':'oculto'} na vista pública.`); break;
    }
    case 'add-entity': {
      requireDm(); const kind = body.kind === 'boss' ? 'bosses' : 'monsters';
      const entity = { id: crypto.randomUUID(), name: (body.entity?.name || '').slice(0, 80) || (kind === 'bosses' ? 'Novo boss' : 'Novo monstro'), hp: Number(body.entity?.hp) || 20, maxHp: Number(body.entity?.maxHp) || Number(body.entity?.hp) || 20, ac: Number(body.entity?.ac) || 12, image: body.entity?.image || '', description:body.entity?.description||'', type:body.entity?.type||'', size:body.entity?.size||'', attacks:body.entity?.attacks||[], initiative:Number(body.entity?.initiative)||0, attackBonus:Number(body.entity?.attackBonus)||0, cr:body.entity?.cr??'', xp:Number(body.entity?.xp)||0, srdIndex:String(body.entity?.srdIndex||''), effects: [], die: body.entity?.die || 'd20', visible: body.entity?.visible!==false };
      state[kind].push(entity); log(`${entity.name} entrou no encontro.`, true, 'note', [{ kind: body.kind === 'boss' ? 'boss' : 'monster', id: entity.id }]); break;
    }
    case 'update-entity': {
      requireDm(); const group = body.kind === 'boss' ? state.bosses : state.monsters; const e = group.find(x => x.id === body.id); if (!e) throw new Error('Criatura não encontrada.');
      for (const k of ['name','hp','maxHp','ac','effects','die','visible','description','type','size','attacks','initiative','attackBonus','image','cr','xp']) if (Object.hasOwn(body.patch || {}, k)) e[k] = body.patch[k];
      e.hp = Math.max(0, Math.min(Number(e.hp) || 0, Number(e.maxHp) || 1)); e.name=String(e.name||'').slice(0,80); e.description=String(e.description||'').slice(0,4000); if(Array.isArray(e.attacks))e.attacks=e.attacks.slice(0,20); log(`${e.name}: estado atualizado.`, true, 'note', [{ kind: body.kind === 'boss' ? 'boss' : 'monster', id: e.id }]); break;
    }
    case 'delete-entity': requireDm(); { const kind=body.kind === 'boss' ? 'boss' : 'monster'; const group = kind === 'boss' ? state.bosses : state.monsters; state[kind === 'boss' ? 'bosses' : 'monsters'] = group.filter(e => e.id !== body.id); pruneActor(kind,body.id); log('Criatura removida do encontro.'); } break;
    case 'clear-encounter': requireDm(); for(const e of state.monsters)pruneActor('monster',e.id); for(const e of state.bosses)pruneActor('boss',e.id); state.monsters=[]; state.bosses=[]; log('Encontro limpo.'); break;
    case 'heal': {
      requireDm(); const amount = Math.max(0, Math.min(9999, Number(body.amount) || 0)); const target = body.target || {};
      if (target.kind === 'player') { const p = state.players.find(x => x.id === Number(target.id)); if (p) { p.hp = Math.min(p.maxHp, p.hp + amount); syncPlayerSheet(p); } else throw new Error('Alvo não encontrado.'); }
      else { const group = target.kind === 'boss' ? state.bosses : state.monsters; const e = group.find(x => x.id === target.id); if (e) e.hp = Math.min(e.maxHp, e.hp + amount); else throw new Error('Alvo não encontrado.'); }
      log(`${target.name || 'Alvo'} recuperou ${amount} PV.`, true, 'note', [{ kind: target.kind, id: target.id }]); break;
    }
    case 'damage': {
      requireDm(); const amount = Math.max(0, Math.min(9999, Number(body.amount) || 0)); const target = body.target || {};
      if (target.kind === 'player') { const p = state.players.find(x => x.id === Number(target.id)); if (p) { p.hp = Math.max(0, p.hp - amount); syncPlayerSheet(p); } else throw new Error('Alvo não encontrado.'); }
      else { const group = target.kind === 'boss' ? state.bosses : state.monsters; const e = group.find(x => x.id === target.id); if (e) e.hp = Math.max(0, e.hp - amount); else throw new Error('Alvo não encontrado.'); }
      log(`${target.name || 'Alvo'} sofreu ${amount} pontos de dano.`, true, 'note', [{ kind: target.kind, id: target.id }]); break;
    }
    case 'effect': {
      requireDm(); const target = body.target || {}; const list = target.kind === 'player' ? state.players : (target.kind === 'boss' ? state.bosses : state.monsters); const e = list.find(x => (target.kind === 'player' ? x.id === Number(target.id) : x.id === target.id)); if (!e) throw new Error('Alvo não encontrado.');
      e.effects ||= []; if (body.remove) e.effects = e.effects.filter(v => v !== body.effect); else if (body.effect && !e.effects.includes(body.effect)) e.effects.push(String(body.effect).slice(0, 60));
      log(`${target.name}: ${body.remove ? 'removeu' : 'recebeu'} o efeito ${body.effect}.`, true, 'note', [{ kind: target.kind, id: target.id }]); break;
    }
    case 'roll': {
      const sides = Number(body.sides); if (![4,6,8,10,12,20,100].includes(sides)) throw new Error('Dado inválido.');
      const count = Math.max(1, Math.min(20, Number(body.count) || 1)); const bonus = Math.max(-999, Math.min(999, Number(body.bonus) || 0));
      const dice = Array.from({ length: count }, () => 1 + crypto.randomInt(sides)); const total = dice.reduce((a,b) => a+b, 0) + bonus;
      const p = role === 'player' ? state.players.find(x => x.id === playerId) : null;
      const entry = { id: crypto.randomUUID(), who: String(role === 'dm' ? (body.sourceName||'DM') : (p?.character || p?.name || `Player ${playerId}`)).slice(0,60), sourceKind:role==='player'?'player':(body.sourceKind||'dm'), entityId:body.entityId||'', label:String(body.label||'').slice(0,60), sides, count, bonus, dice, total, public: true, at: new Date().toISOString(), ...(body.entityId && ['monster','boss'].includes(body.sourceKind) ? { refs: [{ kind: body.sourceKind, id: body.entityId }] } : {}) };
      state.rolls.unshift(entry); state.rolls = state.rolls.slice(0, 200); log(`${entry.who}${entry.label?` · ${entry.label}`:''} lançou ${count}d${sides}${bonus ? (bonus > 0 ? '+' : '') + bonus : ''}: ${dice.join(', ')} = ${total}.`, true, 'roll', entry.refs); break;
    }
    case 'set-mode': requireDm(); if (!['normal','night','battle','day'].includes(body.mode)) throw new Error('Modo inválido.'); state.campaign.mode = body.mode; log(`Ambiente alterado para ${body.mode}.`); break;
    case 'battle-audio': requireDm(); state.battle.audioUrl=body.url||''; state.battle.audioName=body.name||''; state.battle.volume=Math.max(0,Math.min(100,Number(body.volume)||70)); log(state.battle.audioUrl?`Música selecionada: ${state.battle.audioName}.`:'Música de batalha removida.'); break;
    case 'roll-initiative': requireDm(); rollInitiative(); break;
    case 'start-battle': requireDm(); state.campaign.mode='battle'; rollInitiative(); log('⚔ A batalha começou!'); break;
    case 'end-battle': requireDm(); state.campaign.mode=['day','night','normal'].includes(body.mode)?body.mode:'normal'; state.campaign.turnOrder=[]; state.campaign.activeTurn=0; state.campaign.round=1; state.campaign.activeName=''; log('A batalha terminou.'); break;
    case 'turn': {
      requireDm();const order=state.campaign.turnOrder||[];if(order.length){const step=Math.trunc(Number(body.step))||1;const previous=Number(state.campaign.activeTurn)||0;const next=previous+step;if(next>=order.length)state.campaign.round=(Number(state.campaign.round)||1)+1;else if(next<0)state.campaign.round=Math.max(1,(Number(state.campaign.round)||1)-1);state.campaign.activeTurn=((next%order.length)+order.length)%order.length;state.campaign.activeName=order[state.campaign.activeTurn]?.name||'';log(`Turno de ${state.campaign.activeName}.`,true,'note',[order[state.campaign.activeTurn]]);}else{state.campaign.activeTurn=(Number(state.campaign.activeTurn)+1)%6;if(state.campaign.activeTurn===0)state.campaign.round=(Number(state.campaign.round)||1)+1;state.campaign.activeName=state.players[state.campaign.activeTurn]?.character||state.players[state.campaign.activeTurn]?.name;log(`Turno de ${state.campaign.activeName}.`,true,'note',[{kind:'player',id:state.players[state.campaign.activeTurn]?.id}]);}break;
    }
    case 'map-visible': requireDm(); state.map.visible = !!body.visible; log(`Mapa ${state.map.visible ? 'mostrado' : 'ocultado'} aos jogadores.`); break;
    case 'map-options': requireDm(); state.map.grid = body.grid !== false; state.map.gridSize = Math.max(20, Math.min(160, Number(body.gridSize) || 48)); break;
    case 'place-token': { requireDm(); const key=`${body.kind}:${body.id}`,previous=state.map.tokens[key]||{};const x=Math.max(0,Math.min(1,Number(body.x)||0)),y=Math.max(0,Math.min(1,Number(body.y)||0));state.map.tokens[key]={...previous,x,y,size:Math.max(24,Math.min(128,Number(body.size)||Number(previous.size)||42))};if(!previous.x||Math.abs(x-(previous.x||0))>0.005||Math.abs(y-(previous.y||0))>0.005)log(`${String(body.name||'Peça').slice(0,80)} foi movida no mapa.`); } break;
    case 'token-size': { requireDm();const key=String(body.key||'');if(!/^(player:\d+|monster:[\w-]+|boss:[\w-]+)$/.test(key))throw new Error('Peça de mapa inválida.');const previous=state.map.tokens[key]||{x:.5,y:.5};state.map.tokens[key]={...previous,size:Math.max(24,Math.min(128,Number(body.size)||42))};break; }
    case 'annotation': { requireDm(); const color=/^#[0-9a-f]{3,8}$/i.test(String(body.color||''))?body.color:'#e3bd63'; state.map.annotations.push({ id: crypto.randomUUID(), x: Math.max(0,Math.min(1,Number(body.x)||0)), y: Math.max(0,Math.min(1,Number(body.y)||0)), text: String(body.text || '').slice(0,160), points:Array.isArray(body.points)?body.points.slice(0,500).map(p=>({x:Math.max(0,Math.min(1,Number(p?.x)||0)),y:Math.max(0,Math.min(1,Number(p?.y)||0))})):[] , color}); if(state.map.annotations.length>300)state.map.annotations=state.map.annotations.slice(-300); } break;
    case 'clear-annotations': requireDm(); state.map.annotations=[]; break;
    case 'annotations-visible': requireDm(); state.map.annotationsVisible=!!body.visible; log(`Anotações do mapa ${state.map.annotationsVisible?'visíveis':'ocultas'} na vista pública.`); break;
    case 'map-upload': {
      requireDm(); const match = String(body.dataUrl || '').match(/^data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/=]+)$/); if (!match) throw new Error('Escolhe uma imagem PNG, JPEG, WEBP ou GIF.');
      const ext = match[1] === 'jpeg' ? 'jpg' : match[1]; const filename = `${crypto.randomUUID()}.${ext}`; fs.writeFileSync(safeMapPath(filename), Buffer.from(match[2], 'base64'));
      const url=`/maps/${filename}`, name=String(body.name || 'Mapa').replace(/\.[a-z0-9]+$/i,'').slice(0,120);
      if(body.replace&&state.map.url){state.map.url=url;state.map.name||=name;}
      else if(!state.map.url){state.map.url=url;state.map.name=name;if(!state.maps.includes(state.map))state.maps.push(state.map);}
      else {const map=emptyMap(name,url);state.maps.push(map);state.map=map;}
      log(`Mapa carregado: ${name}.`,false,'dm'); break;
    }
    case 'map-select': { requireDm(); const map=state.maps.find(m=>m.id===body.id); if(!map)throw new Error('Mapa não encontrado.'); const wasVisible=state.map.visible; state.map=map; if(body.keepVisible)map.visible=wasVisible; log(map.visible?`Cena: ${map.name}.`:`Mapa preparado: ${map.name}.`,map.visible,'dm'); break; }
    case 'map-rename': { requireDm(); const map=state.maps.find(m=>m.id===body.id)||state.map; map.name=String(body.name||'').trim().slice(0,120)||map.name; break; }
    case 'map-delete': {
      requireDm(); const map=state.maps.find(m=>m.id===body.id); if(!map)throw new Error('Mapa não encontrado.');
      state.maps=state.maps.filter(m=>m!==map);
      if(state.map===map)state.map=state.maps[0]||emptyMap();
      log(`Mapa removido: ${map.name||'sem nome'}.`,false,'dm'); break;
    }
    case 'media-upload': {
      requireDm(); const match=String(body.dataUrl||'').match(/^data:audio\/(mpeg|mp3|wav|x-wav|ogg|webm|mp4|x-m4a|flac);base64,([A-Za-z0-9+/=]+)$/); if(!match)throw new Error('Formato de áudio não suportado. Usa MP3, WAV, OGG, WEBM ou FLAC.');
      const extMap={mpeg:'mp3',mp3:'mp3',wav:'wav','x-wav':'wav',ogg:'ogg',webm:'webm',mp4:'m4a','x-m4a':'m4a',flac:'flac'}; const filename=`${crypto.randomUUID()}.${extMap[match[1]]}`; fs.writeFileSync(path.join(MEDIA_DIR,filename),Buffer.from(match[2],'base64')); state.battle.audioUrl=`/media/${filename}`; state.battle.audioName=String(body.name||'Música de batalha').slice(0,120); state.battle.volume=Math.max(0,Math.min(100,Number(body.volume)||70)); log(`Música carregada: ${state.battle.audioName}.`); break;
    }
    case 'portrait-upload': {
      const id=role==='dm'?Number(body.id):playerId,p=state.players.find(x=>x.id===id);if(!p)throw new Error('Jogador não encontrado.');
      const match=String(body.dataUrl||'').match(/^data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/=]+)$/);if(!match)throw new Error('Escolhe um retrato PNG, JPEG, WEBP ou GIF.');
      const ext=match[1]==='jpeg'?'jpg':match[1],filename=`${crypto.randomUUID()}.${ext}`;fs.writeFileSync(path.join(PORTRAIT_DIR,filename),Buffer.from(match[2],'base64'));p.sheet.identity.portraitUrl=`/portraits/${filename}`;addLog(`Retrato de ${p.character||p.name} atualizado.`);break;
    }
    case 'log': requireDm(); log(String(body.text || '').slice(0,240), true); break;
    case 'import': requireDm(); {
      const incoming = body.state?.data || body.state;
      if (!incoming || !Array.isArray(incoming.characters)) throw new Error('O ficheiro não parece uma exportação válida da aplicação Crónicas.');
      for (let i=0;i<6;i++) { const ch = incoming.characters[i]; if (!ch) continue;const sheet=legacyCharacterToSheet(ch);Object.assign(state.players[i], { character: ch.name || '', ancestry: ch.race || '', className: ch.class || '', level: Number(ch.level)||1, hp: Number(ch.hp)||10, maxHp: Number(ch.max_hp)||Number(ch.hp)||10, ac: Number(ch.ac)||10,sheet }); }
      for (const m of (incoming.monsters || []).slice(0, 50)) state.monsters.push({ id: crypto.randomUUID(), name: String(m.name || 'Monstro').slice(0, 80), hp: Number(m.hp)||20, maxHp: Number(m.max_hp)||Number(m.hp)||20, ac: Number(m.ac)||12, description:String(m.stats||m.description||'').slice(0,4000), attacks:m.attacks||[], effects: [], visible: m.visible!==false,die:m.attack_die||'d20' });
      for (const b of (incoming.bosses || []).slice(0, 50)) state.bosses.push({ id: crypto.randomUUID(), name: String(b.name || 'Boss').slice(0, 80), hp: Number(b.hp)||20, maxHp: Number(b.max_hp)||Number(b.hp)||20, ac: Number(b.ac)||12, description:String(b.stats||b.description||'').slice(0,4000),attacks:b.attacks||[], effects: [], visible: b.revealed!==false,die:b.attack_die||'d20' });
      state.campaign.name = body.state?.campaign_name || state.campaign.name; log('Campanha importada da aplicação Crónicas.');
    } break;
    default: throw new Error('Ação desconhecida.');
  }
  saveAndBroadcast();
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (req.method === 'GET' && url.pathname === '/api/state') {
      const role = url.searchParams.get('role') || 'projector'; const id = Number(url.searchParams.get('id')) || 0;
      if (role === 'player' && (id < 1 || id > 6)) return send(res, 400, { error: 'Player deve ser de 1 a 6.' });
      return send(res, 200, publicState(role, id));
    }
    if (req.method === 'GET' && url.pathname === '/api/events') {
      const role = url.searchParams.get('role') || 'projector'; const id = Number(url.searchParams.get('id')) || 0;
      if (role === 'player' && (id < 1 || id > 6)) return send(res, 400, { error: 'Player deve ser de 1 a 6.' });
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.write(`event: state\ndata: ${JSON.stringify(publicState(role,id))}\n\n`);
      const client = { res, role, playerId: id }; clients.add(client); req.on('close', () => clients.delete(client)); res.on('error', () => clients.delete(client)); return;
    }
    if (req.method === 'GET' && url.pathname.startsWith('/api/catalog/')) {
      const kind=url.pathname.split('/').pop(); if(!SRD_QUERIES[kind])return send(res,404,{error:'Catálogo não suportado.'});
      const query=(url.searchParams.get('q')||'').trim().toLowerCase();
      const results=(await srdCatalog(kind)).filter(item=>!query||item.name.toLowerCase().includes(query)||item.index.includes(query));
      return send(res,200,{count:results.length,results});
    }
    if (req.method === 'GET' && url.pathname === '/api/resource') {
      const resource=url.searchParams.get('url')||''; if(!/^\/api\/2014\/[\w-]+\/[\w-]+$/.test(resource))return send(res,400,{error:'Endereço de recurso inválido.'});
      const lang=url.searchParams.get('lang')==='en'?'en':'pt-BR';
      const detail=await srdCached(`resource:${resource}:${lang}`,()=>srdFetchJson(`${SRD_ORIGIN}${resource}${lang==='en'?'':'?lang=pt-BR'}`));
      if(detail?.image)detail.image=`/srd-images/${String(detail.image).replace(/^\/api\/images\//,'')}`;
      return send(res,200,detail);
    }
    if (req.method === 'GET' && url.pathname.startsWith('/srd-images/')) {
      let file; try { file=await srdImage(decodeURIComponent(url.pathname.slice(12))); } catch { return send(res,404,{error:'Imagem não encontrada.'}); }
      const mime=file.endsWith('.png')?'image/png':file.endsWith('.webp')?'image/webp':'image/jpeg';
      return streamFile(res,file,{'Content-Type':mime,'Cache-Control':'public,max-age=604800','X-Content-Type-Options':'nosniff'});
    }
    if (req.method === 'POST' && url.pathname === '/api/action') {
      const body = await readBody(req); const role = body.role || 'projector'; const id = Number(body.playerId) || 0;
      action(body, role, id); return send(res, 200, { ok: true });
    }
    if (req.method === 'GET' && url.pathname.startsWith('/maps/')) {
      let filename; try { filename = safeMapPath(decodeURIComponent(url.pathname.slice(6))); } catch { return send(res,404,{error:'Não encontrado.'}); }
      if (!fs.existsSync(filename)) return send(res,404,{error:'Não encontrado.'});
      const ext = path.extname(filename).toLowerCase(); const mime = { '.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.gif':'image/gif' }[ext] || 'application/octet-stream';
      return streamFile(res,filename,{ 'Content-Type':mime,'Cache-Control':'public,max-age=3600','X-Content-Type-Options':'nosniff' });
    }
    if (req.method === 'GET' && url.pathname.startsWith('/media/')) {
      const filename=path.basename(decodeURIComponent(url.pathname.slice(7))); if(!/^[\w-]+\.(mp3|wav|ogg|webm|m4a|flac)$/i.test(filename))return send(res,404,{error:'Não encontrado.'}); const file=path.join(MEDIA_DIR,filename); if(!fs.existsSync(file)||!fs.statSync(file).isFile())return send(res,404,{error:'Não encontrado.'});
      const ext=path.extname(file).toLowerCase(); const mime={'.mp3':'audio/mpeg','.wav':'audio/wav','.ogg':'audio/ogg','.webm':'audio/webm','.m4a':'audio/mp4','.flac':'audio/flac'}[ext]||'application/octet-stream'; return streamFile(res,file,{'Content-Type':mime,'Cache-Control':'public,max-age=3600','X-Content-Type-Options':'nosniff'});
    }
    if (req.method === 'GET' && url.pathname.startsWith('/portraits/')) {
      const filename=path.basename(decodeURIComponent(url.pathname.slice(10)));if(!/^[\w-]+\.(png|jpe?g|webp|gif)$/i.test(filename))return send(res,404,{error:'Não encontrado.'});const file=path.join(PORTRAIT_DIR,filename);if(!fs.existsSync(file)||!fs.statSync(file).isFile())return send(res,404,{error:'Não encontrado.'});
      const ext=path.extname(file).toLowerCase();const mime={'.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.gif':'image/gif'}[ext]||'application/octet-stream';return streamFile(res,file,{'Content-Type':mime,'Cache-Control':'public,max-age=3600','X-Content-Type-Options':'nosniff'});
    }
    if (req.method === 'GET') {
      let target = url.pathname === '/' ? '/index.html' : url.pathname;
      if (!/^\/((index|app|style)\.(html|js|css)|icons\.svg)$/.test(target)) target = '/index.html';
      const file = path.join(PUBLIC, target.slice(1));
      if (!fs.existsSync(file)) return send(res,404,'Not found','text/plain; charset=utf-8');
      const mime = file.endsWith('.html') ? 'text/html; charset=utf-8' : file.endsWith('.js') ? 'text/javascript; charset=utf-8' : file.endsWith('.svg') ? 'image/svg+xml' : 'text/css; charset=utf-8';
      return streamFile(res,file,{ 'Content-Type':mime,'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff' });
    }
    send(res,404,{error:'Não encontrado.'});
  } catch (err) { send(res,400,{error:[err.message || 'Erro no pedido.',err.cause?.code||err.cause?.message].filter(Boolean).join(' · ')}); }
});

server.on('error', err => { console.error(`Não foi possível abrir a porta ${PORT}: ${err.code === 'EADDRINUSE' ? 'já existe um Crónicas Web em execução nesta porta.' : err.message}`); process.exit(1); });
server.listen(PORT, HOST, () => {
  console.log(`Crónicas Web ativo em http://localhost:${PORT}`);
  console.log(`DM: http://localhost:${PORT}/dm | Projetor: http://localhost:${PORT}/projector`);
  for (const addresses of Object.values(os.networkInterfaces())) for (const info of addresses || []) if (info.family === 'IPv4' && !info.internal) console.log(`Rede local: http://${info.address}:${PORT}`);
});
