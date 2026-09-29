(() => {
  const $ = (s, ctx=document) => ctx.querySelector(s);
  const $$ = (s, ctx=document) => [...ctx.querySelectorAll(s)];
  let currentStep = 0;
  let agents = [];

  const val = (name, fallback='') => {
    const checked = document.querySelector(`[name="${name}"]:checked`);
    if (checked) return checked.value;
    const el = document.querySelector(`[name="${name}"]`);
    return el ? el.value : fallback;
  };
  const num = (name, fallback=0) => {
    const n = parseFloat(val(name, fallback));
    return Number.isFinite(n) ? n : fallback;
  };
  const multi = (name) => $$(`[name="${name}"]:checked`).map(x => x.value);
  const label = (x) => x ? x.charAt(0).toUpperCase()+x.slice(1) : '';
  const euro = (x) => new Intl.NumberFormat('de-DE',{style:'currency',currency:'EUR',maximumFractionDigits:0}).format(x||0);

  function resetAll(){
    if(!confirm('Aktuelle Eingaben und Ergebnis dieses Checks löschen?')) return;
    location.reload();
  }

  function setStep(n){
    currentStep=Math.max(0,Math.min(5,n));
    $$('.step-pane').forEach((p,i)=>p.classList.toggle('active',i===currentStep));
    $$('.step-list li').forEach((li,i)=>{
      li.classList.toggle('active',i===currentStep);
      li.classList.toggle('done',i<currentStep);
      const icon=$('i',li); if(icon) icon.textContent=i<currentStep?'✓':String(i+1);
    });
    $('#progressBar').style.width=((currentStep)/5*100)+'%';
    window.scrollTo({top:$('#appStart').offsetTop-86,behavior:'smooth'});
  }
  function validateStep(n){
    const pane=$(`.step-pane[data-step="${n}"]`);
    const req=$$('[data-required="true"]',pane);
    let ok=true;
    req.forEach(el=>{
      if(el.type==='radio') {
        if(!document.querySelector(`[name="${el.name}"]:checked`)) ok=false;
      } else if(!el.value) ok=false;
    });
    const msg=$('.validation',pane); if(msg) msg.classList.toggle('show',!ok);
    return ok;
  }

  const map3 = (v) => ({low:0,medium:.5,high:1}[v] ?? 0);
  const map4 = (v) => ({none:0,low:.25,medium:.6,high:1}[v] ?? 0);
  const inv3 = (v) => ({low:1,medium:.5,high:0}[v] ?? 0); // high predictability => low agent opportunity

  function score(){
    // Opportunity values 0..1
    const o={
      variability: map3(val('variability')),
      context_dependence: map3(val('context')),
      research_need: map3(val('research')),
      tool_coordination: ({one:.1,two:.35,three:.7,many:1}[val('systems_count')] ?? 0),
      exception_rate: map3(val('exceptions')),
      planning_need: map3(val('planning')),
      unstructured_data: map3(val('unstructured')),
      multistep: map3(val('multistep'))
    };
    const ow={variability:15,context_dependence:15,research_need:10,tool_coordination:15,exception_rate:10,planning_need:15,unstructured_data:10,multistep:10};
    const opportunity=Math.round(Object.keys(ow).reduce((s,k)=>s+o[k]*ow[k],0));

    const r={
      digital_data: map3(val('digital_data')),
      data_quality: map3(val('data_quality')),
      api_tool_access: map3(val('api_access')),
      roles_permissions: map3(val('roles_permissions')),
      process_owner: val('process_owner')==='yes'?1:0,
      sandbox: val('sandbox')==='yes'?1:val('sandbox')==='partial'?.5:0,
      test_cases: val('test_cases')==='yes'?1:val('test_cases')==='partial'?.5:0,
      logging_monitoring: val('logging')==='yes'?1:val('logging')==='partial'?.5:0,
      escalation_path: val('escalation')==='yes'?1:0
    };
    const rw={digital_data:15,data_quality:10,api_tool_access:15,roles_permissions:15,process_owner:10,sandbox:10,test_cases:10,logging_monitoring:10,escalation_path:5};
    const readiness=Math.round(Object.keys(rw).reduce((s,k)=>s+r[k]*rw[k],0));

    // Risk drivers sum to 100 max.
    let risk=0;
    if(val('sensitive_data')==='yes') risk+=16;
    if(val('external_comm')==='yes') risk+=14;
    if(val('financial_action')==='yes') risk+=18;
    if(val('production_change')==='yes') risk+=16;
    if(val('reversible')==='no') risk+=12; else if(val('reversible')==='partial') risk+=6;
    if(val('regulatory')==='yes') risk+=12;
    if(val('human_approval')==='no') risk+=6;
    if(val('logging')==='no') risk+=6;
    risk=Math.min(100,risk);

    const deterministic = val('predictability')==='high' && val('variability')==='low' && val('exceptions')==='low' && val('context')==='low';
    const needsActions = ['write','critical'].includes(val('action_level'));
    const approval = val('human_approval')==='yes';
    const hasDistinctRoles = val('independent_roles')==='many';

    let classification='Copilot';
    let classKey='copilot';
    if(deterministic || opportunity<30){ classification='Klassische Automatisierung'; classKey='automation'; }
    else if(opportunity<50 && !needsActions){ classification='Copilot'; classKey='copilot'; }
    else if((opportunity>=50 && (approval || val('predictability')==='medium')) || (needsActions && risk>=41)) {classification='Agentischer Hybridprozess';classKey='hybrid';}
    else if(opportunity>=60){ classification='KI-Agent'; classKey='agent'; }
    if(hasDistinctRoles && opportunity>=70 && classKey==='agent'){classification='KI-Agent – Multi-Agent später prüfen';classKey='multi';}

    // Hard gates
    const gates=[];
    if(val('process_owner')==='no') gates.push(['HG-01','Kein Prozessowner','Vor einem Produktionspilot sollte eine verantwortliche Rolle benannt werden.']);
    if(needsActions && val('roles_permissions')==='low') gates.push(['HG-02','Zugriffe nicht ausreichend kontrolliert','Schreibrechte erst nach einem klaren Identitäts- und Berechtigungskonzept.']);
    const critical = val('financial_action')==='yes' || val('production_change')==='yes' || val('reversible')==='no';
    if(critical && !approval) gates.push(['HG-03','Kritische Aktion ohne Freigabe','Autonomie wird auf Draft begrenzt, bis ein Freigabepunkt existiert.']);
    if(critical && val('logging')==='no') gates.push(['HG-04','Kein Logging bei kritischer Aktion','Kritische Aktionen sollten nachvollziehbar protokolliert werden.']);
    if(val('test_cases')==='no') gates.push(['HG-05','Keine Testfälle','Produktionspilot erst nach Aufbau realistischer Evaluationsfälle.']);
    if(deterministic) gates.push(['HG-06','Rein deterministischer Prozess','Klassische Automation ist voraussichtlich einfacher und kontrollierbarer als ein Agent.']);
    if(val('regulatory')==='yes') gates.push(['HG-07','Fachprüfung erforderlich','Rechtliche, regulatorische oder datenschutzrechtliche Einordnung separat fachlich prüfen.']);

    let autonomy= opportunity<30 ? 0 : opportunity<45 ? 1 : opportunity<60 ? 2 : 3;
    if(risk<=20 && opportunity>=70 && readiness>=70 && approval) autonomy=4;
    if(critical && !approval) autonomy=Math.min(2,autonomy);
    if(critical && val('logging')==='no') autonomy=Math.min(2,autonomy);
    if(val('process_owner')==='no' || val('test_cases')==='no') autonomy=Math.min(2,autonomy);
    if(deterministic) autonomy=Math.min(1,autonomy);

    const cases=num('cases',0), minutes=num('minutes',0), hourly=num('hourly',0), control=num('control_minutes',0);
    const baseline=cases*minutes/60*hourly;
    const controlCost=cases*control/60*hourly;
    const scenarios=[.25,.5,.75].map(rate=>({rate,gross:baseline*rate,control:controlCost,netBeforeTech:Math.max(0,baseline*rate-controlCost)}));
    let business='nicht berechnet';
    if(baseline>0){ if(baseline<1000) business='schwach'; else if(baseline<5000) business='prüfenswert'; else if(baseline<15000) business='positiv'; else business='stark'; }

    return {o,opportunity,readiness,risk,classification,classKey,gates,autonomy,baseline,scenarios,business,critical};
  }

  const bandOpportunity = n => n<30?'niedrig':n<55?'mittel':n<75?'hoch':'sehr hoch';
  const bandReadiness = n => n<40?'niedrig':n<70?'mittel':'hoch';
  const bandRisk = n => n<=20?'niedrig':n<=40?'mittel':n<=65?'erhöht':'hoch';
  const autoNames=['Observe','Recommend','Draft','Act with approval','Act within policy','Exception-based autonomy'];

  function reasons(s){
    const positives=[]; const cautions=[];
    if(s.o.variability>=.5) positives.push('Fälle unterscheiden sich und benötigen flexibles Vorgehen.');
    if(s.o.context_dependence>=.5) positives.push('Entscheidungen hängen vom Kontext des Einzelfalls ab.');
    if(s.o.research_need>=.5) positives.push('Der Prozess benötigt Recherche oder zusätzliche Informationsbeschaffung.');
    if(s.o.tool_coordination>=.7) positives.push('Mehrere Systeme oder Werkzeuge müssen koordiniert werden.');
    if(s.o.planning_need>=.5) positives.push('Der Ablauf muss teilweise situationsabhängig geplant werden.');
    if(s.o.unstructured_data>=.5) positives.push('Unstrukturierte Inhalte spielen eine relevante Rolle.');
    if(val('external_comm')==='yes') cautions.push('Externe Kommunikation erhöht den Kontrollbedarf.');
    if(val('sensitive_data')==='yes') cautions.push('Personenbezogene oder vertrauliche Daten sind betroffen.');
    if(val('financial_action')==='yes') cautions.push('Finanzielle Aktionen erhöhen das Schadenspotenzial.');
    if(val('production_change')==='yes') cautions.push('Produktive Systeme oder Daten können verändert werden.');
    if(val('reversible')==='no') cautions.push('Kritische Aktionen sind nicht ohne Weiteres rückgängig zu machen.');
    if(val('regulatory')==='yes') cautions.push('Der Einsatz benötigt zusätzliche fachliche/regulatorische Prüfung.');
    if(!positives.length) positives.push('Der Prozess zeigt nur wenige Merkmale, die zwingend einen KI-Agenten erfordern.');
    if(!cautions.length) cautions.push('Im Check wurden keine ausgeprägten Risikotreiber angegeben.');
    return {positives,cautions};
  }

  function pilotPlan(s){
    const mode=s.classKey==='automation'?'Automation':'Agent';
    return [
      ['Woche 1 – Baseline',`50–500 typische Fälle sammeln, aktuelle Bearbeitungszeit und Qualitätskriterien dokumentieren.`],
      ['Woche 2 – Prototyp',s.classKey==='automation'?'Regelbasierten Workflow in einer Testumgebung umsetzen.':'Nur notwendige Datenquellen anbinden; mit Lese-/Entwurfsrechten beginnen.'],
      ['Woche 3 – Kontrollierter Pilot',`Kleine Nutzergruppe, klare Eskalation und ${s.autonomy>=3?'Freigabepunkte':'menschliche Prüfung'} für kritische Ergebnisse.`],
      ['Woche 4 – Evaluation',`Bearbeitungszeit, Erfolgsquote, Fehler, Eskalationen, Kosten und Nutzerfeedback gegen die Baseline vergleichen.`]
    ];
  }

  function systemTags(){ return multi('systems'); }
  function processCategory(){ return val('process_type')||'other'; }

  function matchAgents(s){
    if(!agents.length) return [];
    const proc=processCategory(), systems=systemTags();
    const categoryWeights={
      customer_service:{'service-sales':6,'unternehmen':3,'automatisierung':2},
      sales:{'service-sales':6,'unternehmen':3,'automatisierung':2},
      research:{'recherche':7,'unternehmen':3,'automatisierung':1},
      procurement:{'recherche':6,'unternehmen':3,'automatisierung':2},
      coding:{'coding':7,'automatisierung':2,'unternehmen':1},
      it:{'automatisierung':5,'coding':4,'unternehmen':3},
      backoffice:{'automatisierung':6,'unternehmen':4},
      knowledge:{'unternehmen':6,'recherche':4,'automatisierung':2},
      legal:{'recht':7,'recherche':3,'unternehmen':2},
      other:{'automatisierung':4,'unternehmen':4,'recherche':2}
    };
    const providerMap={microsoft:['Microsoft'],salesforce:['Salesforce'],sap:['SAP'],servicenow:['ServiceNow'],hubspot:['HubSpot'],zendesk:['Zendesk','Zendesk / Forethought'],atlassian:['Atlassian'],google:['Google'],aws:['AWS'],ibm:['IBM'],oracle:['Oracle'],notion:['Notion']};
    return agents.map(a=>{
      let score=(categoryWeights[proc]||categoryWeights.other)[a.category]||0;
      const reasons=[];
      if(score>=5) reasons.push('passt zur Prozesskategorie');
      systems.forEach(sys=>{if((providerMap[sys]||[]).includes(a.provider)){score+=5;reasons.push('Ökosystembezug zum angegebenen System');}});
      const aud=(a.filters&&a.filters.audience)||[];
      if(aud.includes('unternehmen')){score+=2;reasons.push('für Unternehmen dokumentiert');}
      if(s.classKey==='automation' && a.category==='automatisierung') score+=2;
      if(s.classKey==='agent' && /Agent/i.test(a.type||'')) score+=1;
      return {...a,_score:score,_reasons:[...new Set(reasons)]};
    }).filter(a=>a._score>3).sort((a,b)=>b._score-a._score || a.name.localeCompare(b.name,'de')).slice(0,4);
  }

  function renderResults(){
    save(); const s=score(), rs=reasons(s), matches=matchAgents(s);
    $('#assessmentForm').style.display='none';
    $('#results').classList.add('show');
    $('#progressBar').style.width='100%';
    $('#classification').textContent=s.classification;
    const processName=val('process_name') || 'Ihr Prozess';
    $('#resultIntro').textContent=`${processName}: Die Bewertung trennt Eignung, technische Bereitschaft, Risiko und Wirtschaftlichkeit. Sie ist eine Vorprüfung – keine Garantie für einen erfolgreichen Einsatz.`;

    const metricData=[
      ['Agent Opportunity',bandOpportunity(s.opportunity),s.opportunity],
      ['Implementation Readiness',bandReadiness(s.readiness),s.readiness],
      ['Control & Risk',bandRisk(s.risk),s.risk],
      ['Business Case',s.business,s.baseline?Math.min(100,Math.round(s.baseline/150)):25]
    ];
    $('#metrics').innerHTML=metricData.map(([k,v,n])=>`<div class="metric"><small>${k}</small><b>${v}</b><div class="bar"><i style="width:${n}%"></i></div></div>`).join('');

    $('#positiveReasons').innerHTML=rs.positives.map(x=>`<li>${x}</li>`).join('');
    $('#cautions').innerHTML=rs.cautions.map(x=>`<li>${x}</li>`).join('');
    $('#autonomyName').textContent=`Level ${s.autonomy} – ${autoNames[s.autonomy]}`;
    $('#autonomyBars').innerHTML=[0,1,2,3,4,5].map(i=>`<span class="${i<=s.autonomy?'on':''}"></span>`).join('');
    $('#autonomyText').textContent = s.autonomy<=1?'Analyse und Empfehlungen, keine eigenständigen kritischen Aktionen.':s.autonomy===2?'Aktionen vorbereiten, Ausführung bleibt beim Menschen.':s.autonomy===3?'Aktionen können vorbereitet und nach menschlicher Freigabe ausgeführt werden.':s.autonomy===4?'Begrenzte, reversible Aktionen können innerhalb klarer Policies automatisiert werden.':'Hohe Autonomie nur nach belastbarer Evaluation und klaren Ausnahme-/Eskalationsregeln.';

    $('#gates').innerHTML = s.gates.length ? s.gates.map(g=>`<div style="margin:10px 0"><span class="tag warn">${g[0]}</span> <strong>${g[1]}</strong><div style="color:#66758c;font-size:13px;margin-top:4px">${g[2]}</div></div>`).join('') : '<span class="tag ok">Keine kritischen Hard Gates erkannt</span><p style="color:#66758c">Trotzdem sollten reale Pilotdaten und fachliche Prüfungen vor einer Produktivsetzung berücksichtigt werden.</p>';

    const current = s.baseline;
    $('#baseline').textContent = current?euro(current)+' / Monat':'Nicht berechnet';
    $('#scenarioRows').innerHTML=s.scenarios.map((x,i)=>`<tr><td>${['Konservativ','Mittel','Hoch'][i]}</td><td>${Math.round(x.rate*100)} %</td><td>${euro(x.gross)}</td><td>${euro(x.control)}</td><td><strong>${euro(x.netBeforeTech)}</strong></td></tr>`).join('');

    $('#pilotPlan').innerHTML=pilotPlan(s).map(([a,b])=>`<li><strong>${a}:</strong> ${b}</li>`).join('');
    const kpis=['Bearbeitungszeit pro Vorgang','Erfolgs-/Lösungsquote','Fehler- und Nacharbeitsquote','Eskalationsrate','Kosten pro Vorgang','Akzeptanz bei Nutzern'];
    $('#kpis').innerHTML=kpis.map(x=>`<li>${x}</li>`).join('');

    if(matches.length){
      $('#agentMatches').innerHTML=matches.map(a=>`<a class="agent-match" target="_blank" rel="noopener" href="https://agentenindex.de/agenten/${a.slug}/"><div class="meta">${a.provider} · ${a.type}</div><h4>${a.name}</h4><p>${a.summary}</p><div class="reason">${a._reasons.slice(0,2).join(' · ') || 'thematische Passung'} · geprüft ${a.last_verified}</div></a>`).join('');
    } else $('#agentMatches').innerHTML='<p style="color:#66758c">Für diese Prozessklassifikation wird in v1 kein konkretes Produkt-Matching ausgegeben. Prüfen Sie die Agentenübersicht manuell.</p>';

    $('#resultMethodNote').textContent = s.classKey==='automation' ? 'Die Methodik bevorzugt hier bewusst klassische Automatisierung statt eines KI-Agenten.' : 'Die genannten Agenten sind keine Rangliste. Angezeigt wird nur thematische bzw. Ökosystem-Passung auf Basis dokumentierter AgentenIndex-Daten.';
    window.scrollTo({top:$('#appStart').offsetTop-86,behavior:'smooth'});
  }

  async function loadAgents(){
    try{const r=await fetch('data/agents.json');const d=await r.json();agents=d.agents||[];}catch(e){agents=[];}
  }

  function init(){
    loadAgents();
    $$('.next-step').forEach(btn=>btn.addEventListener('click',()=>{if(validateStep(currentStep)){setStep(currentStep+1);}}));
    $$('.prev-step').forEach(btn=>btn.addEventListener('click',()=>setStep(currentStep-1)));
    $('#showResults').addEventListener('click',()=>{if(validateStep(currentStep))renderResults();});
    $('#resetCheck').addEventListener('click',resetAll);
    $('#resetResult').addEventListener('click',resetAll);
    $('#printReport').addEventListener('click',()=>window.print());
    $('#startCheck').addEventListener('click',()=>document.getElementById('appStart').scrollIntoView({behavior:'smooth'}));
    setStep(0);
  }
  document.addEventListener('DOMContentLoaded',init);
})();
