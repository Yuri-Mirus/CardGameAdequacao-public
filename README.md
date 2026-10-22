# Card Game da Adequação — site público

Este diretório contém somente a interface estática destinada ao GitHub Pages: `index.html`, `style.css`, `game.js` e `supabase-config.js`.

## Testar localmente

1. Instale Python 3 (ou outro servidor HTTP estático).
2. No PowerShell, abra esta pasta e execute `python -m http.server 8000`.
3. Abra `http://localhost:8000` no navegador.
4. Para o jogo e o ranking funcionarem, `supabase-config.js` precisa conter a URL do projeto Supabase e uma chave pública `publishable` válida, e as Edge Functions precisam estar implantadas e configuradas. Esse teste local não substitui a confirmação de gravação/consulta no Supabase.

A página carrega o SDK do Supabase pelo jsDelivr e as fontes pelo Google Fonts; portanto, esses recursos externos dependem de conexão com a internet. Não há imagens, fontes ou bibliotecas locais referenciadas.

## Publicar no GitHub Pages (quando autorizado)

1. Envie somente o conteúdo desta pasta ao repositório público do site.
2. No GitHub, abra **Settings → Pages**.
3. Em **Build and deployment**, selecione **Deploy from a branch**, escolha a branch publicada e a pasta `/ (root)`.
4. Salve e aguarde o endereço do Pages.

A URL do projeto e a chave `publishable` são identificadores/chave pública próprios para o cliente. Nunca coloque aqui senha do banco, `sb_secret` ou chave `service_role`. O repositório do backend e o CSV com o gabarito devem permanecer privados.
