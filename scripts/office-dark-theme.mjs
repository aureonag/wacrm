// Additive CRM stylesheet. Every selector requires the office's resolved dark
// preference; original styles, light mode, artwork and primary colors stay intact.
export const OFFICE_DARK_THEME_CSS = `
body.replica-ui[data-theme=dark]{
  color-scheme:dark;
  --crm-background:#202122;
  --crm-card:#292a2c;
  --crm-card-2:#333537;
  --crm-muted-surface:#37393d;
  --crm-border:#454545;
  --crm-text:#e0e0e0;
  --crm-muted:#b9bcc4;
  color:var(--crm-text);
}
body.replica-ui[data-theme=dark] :is(.r-workspace>button,.r-workspace-menu button){
  color:var(--crm-text);
}
body.replica-ui[data-theme=dark] .r-workspace>button{
  background:var(--crm-card);
}
body.replica-ui[data-theme=dark] .r-workspace-menu{
  border-color:var(--crm-border);
}
body.replica-ui[data-theme=dark] :is(.r-workspace>button,.r-workspace-menu button):is(:hover,:focus-visible){
  background:var(--crm-muted-surface);
}
body.replica-ui[data-theme=dark] .camera-card{
  background:var(--crm-card);
  border-color:var(--crm-border);
}
body.replica-ui[data-theme=dark] .camera-card>div{
  background:var(--crm-card-2);
  color:var(--crm-text);
}
body.replica-ui[data-theme=dark] .camera-card button{
  color:var(--crm-muted);
}
body.replica-ui[data-theme=dark] .camera-card button:is(:hover,:focus-visible){
  background:var(--crm-muted-surface);
  color:var(--crm-text);
}
body.replica-ui[data-theme=dark] .office-popover{
  background:var(--crm-card)!important;
  border-color:var(--crm-border);
  color:var(--crm-text);
}
body.replica-ui[data-theme=dark] .office-popover :is(h3,button){
  color:var(--crm-text);
}
body.replica-ui[data-theme=dark] .office-popover p{
  color:var(--crm-muted);
}
body.replica-ui[data-theme=dark] .office-popover :is(select,option){
  background:var(--crm-card-2);
  border-color:var(--crm-border);
  color:var(--crm-text);
}
body.replica-ui[data-theme=dark] .office-popover button:is(:hover,:focus-visible){
  background:var(--crm-muted-surface);
}
body.replica-ui[data-theme=dark] .person-row:is(:hover,:focus-visible){
  background:var(--crm-muted-surface)!important;
}
body.replica-ui[data-theme=dark] :is(.r-nav-row:hover,.r-nav-row:focus-visible,.rail button.selected){
  background:var(--crm-muted-surface);
}
body.replica-ui[data-theme=dark] .r-segment button{
  color:var(--crm-text);
}
body.replica-ui[data-theme=dark] .r-segment button:is(:hover,:focus-visible,.active){
  background:var(--crm-muted-surface);
  color:var(--crm-text);
}
body.replica-ui[data-theme=dark] :is(.r-empty h2,.r-dialog header button,.r-event-side,.r-activity-row){
  color:var(--crm-text);
}
body.replica-ui[data-theme=dark] :is(.r-event-side,.r-activity-row){
  border-color:var(--crm-border);
}
body.replica-ui[data-theme=dark] :is(.r-event-side,.r-activity-row):is(:hover,:focus-visible){
  background:var(--crm-muted-surface);
}
body.replica-ui[data-theme=dark] :is(.r-dialog .r-help,.r-empty,.r-loading,.r-event-side small,.r-activity-row small,.r-setting-row p,.r-settings-tabs small,.r-sidebar-section,.r-nav-row small,.r-call-status,.person-row small,.presence-group summary,.r-floor small,.r-shortcut,.r-settings-section){
  color:var(--crm-muted);
}
body.replica-ui[data-theme=dark] .r-compose textarea{
  color:var(--crm-text);
}
body.replica-ui[data-theme=dark] .people-search{
  background:var(--crm-card-2)!important;
  color:var(--crm-text);
}
body.replica-ui[data-theme=dark] .people-search kbd{
  background:var(--crm-muted-surface);
  border-color:var(--crm-border);
  color:var(--crm-muted);
}
body.replica-ui[data-theme=dark] :is(.people-search input,.r-search-input,.r-sidebar-search,.r-compose textarea,.r-dialog input,.r-dialog textarea)::placeholder{
  color:var(--crm-muted);
  opacity:1;
}
body.replica-ui[data-theme=dark] :is(.r-workspace-menu button,.office-popover button,.r-segment button):disabled{
  color:var(--crm-muted);
  cursor:not-allowed;
}
`;
