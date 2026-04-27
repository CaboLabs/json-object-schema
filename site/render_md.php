<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Documento de especificacion de requerimientos</title>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/markdown-it/13.0.2/markdown-it.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/mermaid/dist/mermaid.min.js"></script>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            max-width: 900px;
            margin: 0 auto;
            padding: 20px;
            background-color: #f5f5f5;
        }
        
        .mermaid {
            display: flex;
            justify-content: center;
            margin: 20px 0;
        }

        .loading {
            color: #666;
            font-style: italic;
        }
        .error {
            background-color: #fee;
            color: #c33;
            padding: 12px;
            border-radius: 4px;
            margin-bottom: 20px;
            border-left: 4px solid #c33;
        }
        .content {
            background: white;
            padding: 1px 30px 30px 30px;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        .content h1 { font-size: 28px; margin: 30px 0 15px 0; }
        .content h2 { font-size: 24px; margin: 25px 0 12px 0; }
        .content h3 { font-size: 20px; margin: 20px 0 10px 0; }
        .content p { margin: 12px 0; line-height: 1.7; }
        .content ul, .content ol { margin: 12px 0; padding-left: 30px; }
        .content li { margin: 6px 0; }
        .content table {
            border-collapse: collapse;
            margin: 20px 0;
            width: 100%;
        }
        .content th, .content td {
            border: 1px solid #ddd;
            padding: 10px 12px;
            text-align: left;
        }
        .content th {
            background-color: #f8f8f8;
            font-weight: 600;
        }
        .content code {
            background-color: #f4f4f4;
            padding: 2px 6px;
            border-radius: 3px;
            font-family: 'Monaco', 'Menlo', monospace;
            font-size: 13px;
        }
        .content pre {
            background-color: #f4f4f4;
            padding: 15px;
            border-radius: 4px;
            overflow-x: auto;
        }
        .content pre code {
            background-color: transparent;
            padding: 0;
        }
        .content blockquote {
            border-left: 4px solid #ddd;
            margin: 15px 0;
            padding-left: 15px;
            color: #666;
        }
        img {
            width: 100%;
        }
    </style>
</head>
<body>

    <div id="error" class="error" style="display: none;"></div>
    <div id="loading" class="loading" style="display: none; padding: 20px; text-align: center;">Loading...</div>
    <div id="content" class="content"></div>

    <script>
        // Initialize mermaid
        mermaid.initialize({ startOnLoad: true, theme: 'default' });

        // Create markdown-it instance with mermaid plugin
        const md = window.markdownit({
            html: true,
            linkify: true,
            typographer: true
        });
        // Plugin to handle mermaid code blocks
        md.renderer.rules.fence = function(tokens, idx, options, env, renderer) {
            const token = tokens[idx];
            const info = token.info.trim();
            const content = token.content;

            // Check if this is a mermaid code block
            if (info === 'mermaid') {
                console.log(content);
                
                return `<div class="mermaid">${content}</div>`;
            }

            // Default code block handling
            return `<pre><code class="language-${info}">${md.utils.escapeHtml(content)}</code></pre>`;
        };

        
        async function loadFile() {
            const filename = '<?= htmlspecialchars($_REQUEST['md'] ?? '', ENT_QUOTES) ?>';
            
            if (!filename) {
                showError('Please enter a filename');
                return;
            }

            showLoading(true);
            clearError();

            try {
                const response = await fetch(filename);
                
                if (!response.ok) {
                    throw new Error(`Failed to load file: ${response.status} ${response.statusText}`);
                }

                const markdown = await response.text();
                const html = md.render(markdown);

                const contentEl = document.getElementById('content');
                contentEl.innerHTML = html;

                // Add IDs to headings using GitHub-style slugs so TOC links resolve
                contentEl.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach(h => {
                    if (!h.id) {
                        h.id = h.textContent.trim()
                            .toLowerCase()
                            .replace(/\s+/g, '-')
                            .replace(/[^\w-]/g, '');
                    }
                });

                // Scroll to hash if present in URL
                if (location.hash) {
                    const target = document.getElementById(location.hash.slice(1));
                    if (target) target.scrollIntoView();
                }

                // Render mermaid diagrams
                mermaid.contentLoaded();
            } catch (error) {
                showError(`Error: ${error.message}`);
                document.getElementById('content').innerHTML = '';
            } finally {
                showLoading(false);
            }
        }

        // Load default file on page load
        document.addEventListener('DOMContentLoaded', loadFile);

        // Handle hash link clicks after dynamic content load
        document.addEventListener('click', e => {
            const link = e.target.closest('a[href^="#"]');
            if (!link) return;
            const id = link.getAttribute('href').slice(1);
            const target = document.getElementById(id);
            if (target) {
                e.preventDefault();
                target.scrollIntoView({ behavior: 'smooth', block: 'start' });
                history.pushState(null, '', '#' + id);
            }
        });


        function showLoading(show) {
            document.getElementById('loading').style.display = show ? 'block' : 'none';
        }

        function showError(message) {
            const errorDiv = document.getElementById('error');
            errorDiv.textContent = message;
            errorDiv.style.display = 'block';
        }

        function clearError() {
            document.getElementById('error').style.display = 'none';
        }
    </script>
</body>
</html>