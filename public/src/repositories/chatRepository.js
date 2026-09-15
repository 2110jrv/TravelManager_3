export const createChatRepository=()=>({pending:[],enqueue(message){this.pending.push({...message,syncStatus:'PENDING'});return this.pending.at(-1)}});
