/**
 * Mapping familles de métiers Taleos ↔ Société Générale
 * Taleos = profil utilisateur (Mon profil)
 * SG = options du formulaire socgen.taleo.net
 *
 * Une catégorie Taleos peut correspondre à 1 ou plusieurs catégories SG et réciproquement.
 */

/** Options exactes du formulaire Société Générale (texte affiché) */
const SG_JOB_FAMILIES = [
  'ACHATS ET APPROVISIONNEMENTS',
  'AUDIT, CONTROLE ET QUALITE',
  'AUTRE FAMILLE D\'EMPLOI',
  'BACK-OFFICE/MIDDLE-OFFICE',
  'BANQUE FINANC ET INVESTIS',
  'COMMUNICATION',
  'CONFORMITE',
  'DEVELOPP-COORD ACTIVITES',
  'DIRECTION GENERALE',
  'DISTRIBUTION MULTICANAL',
  'FINANCE',
  'GESTION D ACTIFS',
  'GESTION ET ADMINISTRATION',
  'GESTION PRIVEE',
  'IMMOBILIER',
  'JURIDIQUE, FISCALITE, ASSURANC',
  'MARKETING',
  'PROJETORGPROCESSINNOV',
  'RESSOURCES HUMAINES',
  'RISQUES',
  'SERVICES GENERAUX',
  'STRATEGIE',
  'SYSTEME D\'INFORMATION'
];

/**
 * Mapping Taleos → SG (chaque clé Taleos pointe vers un ou plusieurs libellés SG)
 */
const TALEOS_TO_SG = {
  'Achat': ['ACHATS ET APPROVISIONNEMENTS'],
  'Administration / Services Généraux': ['SERVICES GENERAUX', 'GESTION ET ADMINISTRATION'],
  'Analyse financière et économique': ['FINANCE', 'BANQUE FINANC ET INVESTIS'],
  'Assurances': ['JURIDIQUE, FISCALITE, ASSURANC'],
  'Autres': ['AUTRE FAMILLE D\'EMPLOI'],
  'Commercial / Relations Clients': ['DISTRIBUTION MULTICANAL'],
  'Conformité / Sécurité financière': ['CONFORMITE'],
  'Direction générale': ['DIRECTION GENERALE'],
  'Financement et Investissement': ['BANQUE FINANC ET INVESTIS', 'FINANCE'],
  'Finances / Comptabilité / Contrôle de gestion': ['FINANCE'],
  'Gestion d\'Actifs': ['GESTION D ACTIFS'],
  'Gestion des opérations': ['BACK-OFFICE/MIDDLE-OFFICE', 'GESTION ET ADMINISTRATION'],
  'Immobilier': ['IMMOBILIER'],
  'Inspection / Audit': ['AUDIT, CONTROLE ET QUALITE'],
  'Juridique': ['JURIDIQUE, FISCALITE, ASSURANC'],
  'Marketing et Communication': ['MARKETING', 'COMMUNICATION'],
  'Métiers du médical et social': ['AUTRE FAMILLE D\'EMPLOI'],
  'Organisation / Qualité': ['AUDIT, CONTROLE ET QUALITE', 'PROJETORGPROCESSINNOV'],
  'Recouvrement / Contentieux': ['JURIDIQUE, FISCALITE, ASSURANC'],
  'Ressources Humaines': ['RESSOURCES HUMAINES'],
  'Risques / Contrôles permanents': ['RISQUES'],
  'IT, Digital et Data': ['SYSTEME D\'INFORMATION'],
  'RSE / ESG': ['STRATEGIE']
};

/**
 * Convertit les familles Taleos (profil) en familles SG à sélectionner.
 * @param {string[]} taleosJobs - Tableau des métiers sélectionnés sur Taleos
 * @returns {string[]} Familles SG uniques à cocher/sélectionner
 */
function mapTaleosToSgFamilies(taleosJobs) {
  if (!Array.isArray(taleosJobs) || taleosJobs.length === 0) return [];
  const sgSet = new Set();
  for (const job of taleosJobs) {
    const j = String(job || '').trim();
    if (!j) continue;
    const mapped = TALEOS_TO_SG[j];
    if (mapped) {
      mapped.forEach(s => sgSet.add(s));
    } else {
      sgSet.add('AUTRE FAMILLE D\'EMPLOI');
    }
  }
  return Array.from(sgSet);
}
