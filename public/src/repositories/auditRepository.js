export const createAuditRepository=()=>({issues:[],save(issue){this.issues.push(issue);return issue},list(){return this.issues}});
