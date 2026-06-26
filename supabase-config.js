'use strict';

/* ════════════════════════════════════════════════════════
   Configuración de Supabase
   ────────────────────────────────────────────────────────
   La anon key es PÚBLICA por diseño: solo permite operar
   bajo las políticas RLS (cada usuario ve únicamente sus
   propios datos). No expone datos ajenos.
   ════════════════════════════════════════════════════════ */
const SUPABASE_URL = 'https://phhhurtyesvnozhvvyky.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBoaGh1cnR5ZXN2bm96aHZ2eWt5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI0ODUzODYsImV4cCI6MjA5ODA2MTM4Nn0.ZaefbF729dFbAHr78MEsAhpb744-CjnqoMfjhGZd-6E';

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
