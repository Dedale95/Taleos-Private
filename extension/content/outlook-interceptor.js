/**
 * Taleos - Outlook Web Interceptor
 * Ce script s'exécute sur outlook.live.com ou outlook.office.com.
 * Il surveille l'arrivée d'emails BPCE/Oracle et extrait le code PIN.
 */

(function() {
  'use strict';

  function log(msg) {
    console.log(`[${new Date().toLocaleTimeString('fr-FR')}] [Taleos Outlook] ${msg}`);
  }

  // Regex pour extraire le code à 6 chiffres
  const PIN_REGEX = /\b(\d{6})\b/;
  const ORACLE_SENDER = 'ekez.fa.sender@workflow.mail.em2.cloud.oracle.com';

  function scanEmails() {
    // 1. Chercher dans la liste des messages (snippets)
    const messages = document.querySelectorAll('[role="option"], [data-testid="CustomNode"]');
    for (const msg of messages) {
      const text = msg.textContent || '';
      if (text.includes('Confirmer votre identité') || text.includes(ORACLE_SENDER)) {
        const match = text.match(PIN_REGEX);
        if (match) {
          const pinCode = match[1];
          log('📌 Code PIN trouvé dans la liste Outlook : ' + pinCode);
          chrome.runtime.sendMessage({ action: 'bpce_pin_code', pinCode });
          return;
        }
      }
    }

    // 2. Chercher dans le corps du message ouvert
    const body = document.querySelector('[role="main"]') || document.querySelector('#ItemField_0');
    if (body) {
      const text = body.textContent || '';
      if (text.includes('code d\'accès à usage unique')) {
        const match = text.match(PIN_REGEX);
        if (match) {
          const pinCode = match[1];
          log('📌 Code PIN trouvé dans le corps du mail Outlook : ' + pinCode);
          chrome.runtime.sendMessage({ action: 'bpce_pin_code', pinCode });
        }
      }
    }
  }

  // Scanner régulièrement et lors de mutations
  setInterval(scanEmails, 3000);
  
  const observer = new MutationObserver(scanEmails);
  observer.observe(document.body, { childList: true, subtree: true });
  
  log('👁️  Outlook Interceptor actif : surveillance des emails BPCE...');
})();
