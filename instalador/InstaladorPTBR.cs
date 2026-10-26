// Instalador da tradução PT-BR de Look Outside.
// Única função: copiar os dois plugins da tradução para a pasta do jogo e
// registrá-los em js/plugins.js (ou desfazer isso). Não toca em data, saves,
// imagens, áudios nem em outros plugins. Compilado por tools/build-release.ps1.
using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Win32;

[assembly: AssemblyTitle("Look Outside PT-BR - Instalador")]
[assembly: AssemblyProduct("Look Outside PT-BR")]
[assembly: AssemblyDescription("Instala ou remove a tradução PT-BR de Look Outside.")]

namespace LookOutsidePTBR
{
    public enum Estado { NaoInstalada, Instalada, Desatualizada, Incompleta }

    public static class Mod
    {
        public const string Catalogo = "LookOutside_PTBR_catalog";
        public const string Plugin = "LookOutside_PTBR";
        public static readonly string[] Plugins = { Catalogo, Plugin };
        const string NomeBackup = "plugins.js.backup-ptbr";
        static readonly UTF8Encoding Utf8 = new UTF8Encoding(false);
        static readonly Regex NomeRegistro = new Regex("\"name\"\\s*:\\s*\"(LookOutside_PTBR(?:_catalog)?)\"");

        public static string Registros(string nl)
        {
            return "{\"name\":\"" + Catalogo + "\",\"status\":true,\"description\":\"PT-BR text catalog\",\"parameters\":{}}," + nl +
                   "{\"name\":\"" + Plugin + "\",\"status\":true,\"description\":\"PT-BR translation overlay\",\"parameters\":{}}";
        }

        public static byte[] Embutido(string plugin)
        {
            using (Stream s = Assembly.GetExecutingAssembly().GetManifestResourceStream(plugin + ".js"))
            {
                if (s == null) throw new InvalidOperationException("Instalador incompleto: " + plugin + ".js não está embutido.");
                MemoryStream m = new MemoryStream();
                s.CopyTo(m);
                return m.ToArray();
            }
        }

        static string PluginsJs(string jogo) { return Path.Combine(jogo, "js", "plugins.js"); }
        static string ArquivoPlugin(string jogo, string plugin) { return Path.Combine(jogo, "js", "plugins", plugin + ".js"); }

        // Retorna null quando a pasta é do jogo; senão, o motivo.
        public static string Validar(string jogo)
        {
            if (string.IsNullOrWhiteSpace(jogo) || !Directory.Exists(jogo)) return "Pasta não encontrada.";
            foreach (string f in new[] { "Game.exe", Path.Combine("data", "System.json"), Path.Combine("js", "plugins.js") })
                if (!File.Exists(Path.Combine(jogo, f))) return "Esta pasta não parece ser a do Look Outside (falta " + f + ").";
            return null;
        }

        public static bool TituloConfere(string jogo)
        {
            try { return File.ReadAllText(Path.Combine(jogo, "data", "System.json")).Contains("Look Outside"); }
            catch { return false; }
        }

        public static bool JogoAberto(string jogo)
        {
            string exe = Path.GetFullPath(Path.Combine(jogo, "Game.exe"));
            foreach (Process p in Process.GetProcessesByName("Game"))
            {
                try { if (string.Equals(Path.GetFullPath(p.MainModule.FileName), exe, StringComparison.OrdinalIgnoreCase)) return true; }
                catch { }
            }
            return false;
        }

        static string LerTexto(string caminho, out bool bom)
        {
            byte[] b = File.ReadAllBytes(caminho);
            bom = b.Length >= 3 && b[0] == 0xEF && b[1] == 0xBB && b[2] == 0xBF;
            return Utf8.GetString(b, bom ? 3 : 0, b.Length - (bom ? 3 : 0));
        }

        static void GravarSeguro(string caminho, byte[] dados)
        {
            string tmp = caminho + ".tmp-ptbr";
            File.WriteAllBytes(tmp, dados);
            File.Copy(tmp, caminho, true);
            File.Delete(tmp);
        }

        static byte[] ComBom(string texto, bool bom)
        {
            byte[] corpo = Utf8.GetBytes(texto);
            return bom ? new byte[] { 0xEF, 0xBB, 0xBF }.Concat(corpo).ToArray() : corpo;
        }

        static HashSet<string> RegistrosPresentes(string texto)
        {
            return new HashSet<string>(NomeRegistro.Matches(texto).Cast<Match>().Select(m => m.Groups[1].Value));
        }

        static bool Iguais(byte[] a, byte[] b)
        {
            using (SHA256 h = SHA256.Create()) return h.ComputeHash(a).SequenceEqual(h.ComputeHash(b));
        }

        public static Estado Verificar(string jogo)
        {
            bool bom;
            HashSet<string> registros = RegistrosPresentes(LerTexto(PluginsJs(jogo), out bom));
            int arquivos = 0, atuais = 0;
            foreach (string p in Plugins)
            {
                string f = ArquivoPlugin(jogo, p);
                if (!File.Exists(f)) continue;
                arquivos++;
                if (Iguais(File.ReadAllBytes(f), Embutido(p))) atuais++;
            }
            if (registros.Count == 0 && arquivos == 0) return Estado.NaoInstalada;
            if (registros.Count < 2 || arquivos < 2) return Estado.Incompleta;
            return atuais == 2 ? Estado.Instalada : Estado.Desatualizada;
        }

        static string Inserir(string texto)
        {
            int fim = texto.LastIndexOf(']');
            if (!texto.Contains("$plugins") || fim < 0 || texto.Substring(fim + 1).Trim().TrimEnd(';').Trim().Length > 0)
                throw new InvalidOperationException("Formato de js/plugins.js desconhecido. Nada foi alterado.");
            int p = fim - 1;
            while (p >= 0 && char.IsWhiteSpace(texto[p])) p--;
            string nl = texto.Contains("\r\n") ? "\r\n" : "\n";
            string bloco = (texto[p] == '[' ? "" : ",") + nl + Registros(nl);
            return texto.Insert(p + 1, bloco);
        }

        static string Retirar(string texto)
        {
            foreach (string nl in new[] { "\r\n", "\n" })
                foreach (string prefixo in new[] { "," + nl, nl })
                {
                    string bloco = prefixo + Registros(nl);
                    int i = texto.IndexOf(bloco, StringComparison.Ordinal);
                    if (i >= 0) return texto.Remove(i, bloco.Length);
                }
            // Registros gravados em outro formato: reescreve a lista sem eles.
            Match m = Regex.Match(texto, "(?s)\\bvar\\s+\\$plugins\\s*=\\s*(\\[.*\\])\\s*;?\\s*$");
            if (!m.Success) throw new InvalidOperationException("Formato de js/plugins.js desconhecido. Nada foi alterado.");
            JavaScriptSerializer json = new JavaScriptSerializer { MaxJsonLength = int.MaxValue };
            ArrayList lista = json.Deserialize<ArrayList>(m.Groups[1].Value);
            List<string> linhas = new List<string>();
            foreach (object o in lista)
            {
                IDictionary<string, object> d = o as IDictionary<string, object>;
                if (d != null && d.ContainsKey("name") && Plugins.Contains(d["name"] as string)) continue;
                linhas.Add(json.Serialize(o));
            }
            return "// Generated by RPG Maker.\n// Do not edit this file directly.\nvar $plugins =\n[\n" + string.Join(",\n", linhas) + "\n];\n";
        }

        public static string Instalar(string jogo)
        {
            string pluginsJs = PluginsJs(jogo);
            byte[] originalPlugins = File.ReadAllBytes(pluginsJs);
            bool bom;
            string texto = LerTexto(pluginsJs, out bom);
            HashSet<string> registros = RegistrosPresentes(texto);
            string backup = Path.Combine(jogo, "js", NomeBackup);
            if (registros.Count == 0 && !File.Exists(backup)) File.Copy(pluginsJs, backup);

            Dictionary<string, byte[]> anteriores = new Dictionary<string, byte[]>();
            foreach (string p in Plugins)
            {
                string f = ArquivoPlugin(jogo, p);
                anteriores[f] = File.Exists(f) ? File.ReadAllBytes(f) : null;
            }
            try
            {
                Directory.CreateDirectory(Path.Combine(jogo, "js", "plugins"));
                foreach (string p in Plugins) GravarSeguro(ArquivoPlugin(jogo, p), Embutido(p));
                if (registros.Count < 2)
                {
                    if (registros.Count > 0) texto = Retirar(texto);
                    GravarSeguro(pluginsJs, ComBom(Inserir(texto), bom));
                }
                if (Verificar(jogo) != Estado.Instalada) throw new InvalidOperationException("A verificação após a instalação falhou.");
            }
            catch
            {
                try { File.WriteAllBytes(pluginsJs, originalPlugins); } catch { }
                foreach (KeyValuePair<string, byte[]> a in anteriores)
                {
                    try
                    {
                        if (a.Value != null) File.WriteAllBytes(a.Key, a.Value);
                        else if (File.Exists(a.Key)) File.Delete(a.Key);
                    }
                    catch { }
                }
                throw;
            }
            return "Tradução instalada. Abra o jogo pela Steam normalmente.";
        }

        public static string Remover(string jogo)
        {
            string pluginsJs = PluginsJs(jogo);
            bool bom;
            string texto = LerTexto(pluginsJs, out bom);
            if (RegistrosPresentes(texto).Count > 0) GravarSeguro(pluginsJs, ComBom(Retirar(texto), bom));
            foreach (string p in Plugins)
            {
                string f = ArquivoPlugin(jogo, p);
                if (File.Exists(f)) File.Delete(f);
            }
            string backup = Path.Combine(jogo, "js", NomeBackup);
            if (File.Exists(backup) && Iguais(File.ReadAllBytes(backup), File.ReadAllBytes(pluginsJs))) File.Delete(backup);
            return "Tradução removida. O jogo voltou ao inglês.";
        }

        // Pastas comuns, registro da Steam e bibliotecas extras (libraryfolders.vdf).
        public static string Localizar()
        {
            List<string> raizes = new List<string>();
            string aqui = AppDomain.CurrentDomain.BaseDirectory;
            raizes.Add(aqui);
            raizes.Add(Path.GetDirectoryName(aqui.TrimEnd('\\')) ?? aqui);
            List<string> steam = new List<string>();
            foreach (string[] chave in new[] {
                new[] { "HKEY_CURRENT_USER\\Software\\Valve\\Steam", "SteamPath" },
                new[] { "HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\Valve\\Steam", "InstallPath" },
                new[] { "HKEY_LOCAL_MACHINE\\SOFTWARE\\Valve\\Steam", "InstallPath" } })
            {
                try { string v = Registry.GetValue(chave[0], chave[1], null) as string; if (!string.IsNullOrEmpty(v)) steam.Add(v.Replace('/', '\\')); }
                catch { }
            }
            steam.Add(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "Steam"));
            steam.Add(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Steam"));
            foreach (string s in steam.Distinct(StringComparer.OrdinalIgnoreCase).ToList())
            {
                raizes.Add(Path.Combine(s, "steamapps", "common", "Look Outside"));
                try
                {
                    string vdf = File.ReadAllText(Path.Combine(s, "steamapps", "libraryfolders.vdf"));
                    foreach (Match m in Regex.Matches(vdf, "\"path\"\\s+\"([^\"]+)\""))
                        raizes.Add(Path.Combine(m.Groups[1].Value.Replace("\\\\", "\\"), "steamapps", "common", "Look Outside"));
                }
                catch { }
            }
            foreach (string r in raizes)
                if (Validar(r) == null) return Path.GetFullPath(r).TrimEnd('\\');
            return null;
        }
    }

    class Janela : Form
    {
        readonly TextBox pasta = new TextBox();
        readonly Label estado = new Label();
        readonly Button instalar = new Button();
        readonly Button remover = new Button();
        readonly string acaoPendente;
        const string Email = "ewertoncbranco@gmail.com";

        public Janela(string pastaInicial, string acao)
        {
            acaoPendente = acao;
            Text = "Look Outside — Tradução PT-BR";
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            AutoScaleDimensions = new SizeF(96F, 96F);
            AutoScaleMode = AutoScaleMode.Dpi;
            Font = new Font("Segoe UI", 9.5F);
            ClientSize = new Size(840, 430);
            try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }

            // Logo à esquerda; os controles ficam na coluna da direita (x = 300).
            Panel lateral = new Panel { BackColor = Color.FromArgb(16, 16, 16), Location = new Point(0, 0), Size = new Size(280, 430) };
            PictureBox logo = new PictureBox { Location = new Point(20, 95), Size = new Size(240, 240), SizeMode = PictureBoxSizeMode.Zoom, BackColor = Color.Transparent };
            using (Stream s = Assembly.GetExecutingAssembly().GetManifestResourceStream("logo.png"))
                if (s != null) logo.Image = new Bitmap(s);
            lateral.Controls.Add(logo);

            Label titulo = new Label { Text = "Tradução PT-BR de Look Outside", Font = new Font("Segoe UI", 14F, FontStyle.Bold), AutoSize = true, Location = new Point(300, 16) };
            Label rotulo = new Label { Text = "Pasta do jogo:", AutoSize = true, Location = new Point(300, 62) };
            pasta.SetBounds(300, 84, 420, 26);
            pasta.TextChanged += delegate { Atualizar(); };
            Button procurar = new Button { Text = "Procurar...", Location = new Point(730, 82), Size = new Size(90, 30) };
            procurar.Click += delegate { Procurar(); };
            estado.SetBounds(300, 122, 520, 44);
            estado.Font = new Font("Segoe UI", 10F, FontStyle.Bold);
            instalar.SetBounds(300, 172, 255, 42);
            instalar.Click += delegate { Executar("install"); };
            remover.SetBounds(565, 172, 255, 42);
            remover.Text = "Remover tradução";
            remover.Click += delegate { Executar("uninstall"); };
            Label nota = new Label
            {
                Text = "Feche o jogo antes de continuar. Só a lista de plugins (js\\plugins.js) e os dois arquivos da tradução são alterados; saves, dados, imagens e sons ficam intactos. Se a Steam atualizar o jogo e o inglês voltar, abra este programa e instale de novo.",
                ForeColor = SystemColors.GrayText,
                Location = new Point(300, 226),
                Size = new Size(520, 84)
            };
            Label beta = new Label
            {
                Text = "Tradução em versão beta: ainda pode haver erros. Se encontrar algum, tire um print da tela, escreva onde ele aparece no jogo e o que está errado, e envie para:",
                ForeColor = Color.DarkRed,
                Location = new Point(300, 316),
                Size = new Size(520, 66)
            };
            LinkLabel email = new LinkLabel { Text = Email, AutoSize = true, Location = new Point(300, 388), Font = new Font("Segoe UI", 10F, FontStyle.Bold) };
            email.LinkClicked += delegate
            {
                try { Process.Start("mailto:" + Email + "?subject=" + Uri.EscapeDataString("Erro na tradução PT-BR de Look Outside")); }
                catch { Clipboard.SetText(Email); MessageBox.Show(this, "Endereço copiado: " + Email, Text, MessageBoxButtons.OK, MessageBoxIcon.Information); }
            };
            Controls.AddRange(new Control[] { lateral, titulo, rotulo, pasta, procurar, estado, instalar, remover, nota, beta, email });

            pasta.Text = pastaInicial ?? Mod.Localizar() ?? "";
            Atualizar();
            Shown += delegate { if (acaoPendente != null) Executar(acaoPendente); };
        }

        void Procurar()
        {
            using (FolderBrowserDialog d = new FolderBrowserDialog { Description = "Escolha a pasta onde está o Game.exe do Look Outside (Steam: botão direito no jogo > Gerenciar > Ver arquivos locais)." })
            {
                if (Directory.Exists(pasta.Text)) d.SelectedPath = pasta.Text;
                if (d.ShowDialog(this) == DialogResult.OK) pasta.Text = d.SelectedPath;
            }
        }

        void Atualizar()
        {
            string erro = Mod.Validar(pasta.Text);
            instalar.Text = "Instalar tradução";
            if (erro != null)
            {
                estado.Text = string.IsNullOrWhiteSpace(pasta.Text) ? "Jogo não encontrado automaticamente. Clique em \"Procurar...\"." : erro;
                estado.ForeColor = Color.Firebrick;
                instalar.Enabled = remover.Enabled = false;
                return;
            }
            Estado e;
            try { e = Mod.Verificar(pasta.Text); }
            catch (Exception ex) { estado.Text = "Não foi possível ler a pasta: " + ex.Message; estado.ForeColor = Color.Firebrick; instalar.Enabled = remover.Enabled = false; return; }
            switch (e)
            {
                case Estado.Instalada: estado.Text = "Tradução instalada e atualizada."; estado.ForeColor = Color.SeaGreen; instalar.Text = "Reinstalar tradução"; break;
                case Estado.Desatualizada: estado.Text = "Há uma versão diferente da tradução instalada."; estado.ForeColor = Color.DarkOrange; instalar.Text = "Atualizar tradução"; break;
                case Estado.Incompleta: estado.Text = "Instalação incompleta (provavelmente após atualização do jogo)."; estado.ForeColor = Color.DarkOrange; instalar.Text = "Reparar tradução"; break;
                default: estado.Text = "Jogo encontrado. Tradução não instalada."; estado.ForeColor = SystemColors.ControlText; break;
            }
            instalar.Enabled = true;
            remover.Enabled = e != Estado.NaoInstalada;
        }

        void Executar(string acao)
        {
            string jogo = pasta.Text.Trim();
            if (Mod.Validar(jogo) != null) { Atualizar(); return; }
            if (!Mod.TituloConfere(jogo) && MessageBox.Show(this, "O título do jogo nesta pasta não é \"Look Outside\". Continuar mesmo assim?", Text, MessageBoxButtons.YesNo, MessageBoxIcon.Warning) != DialogResult.Yes) return;
            if (Mod.JogoAberto(jogo)) { MessageBox.Show(this, "Feche o Look Outside antes de continuar.", Text, MessageBoxButtons.OK, MessageBoxIcon.Warning); return; }
            try
            {
                string msg = acao == "install" ? Mod.Instalar(jogo) : Mod.Remover(jogo);
                MessageBox.Show(this, msg, Text, MessageBoxButtons.OK, MessageBoxIcon.Information);
            }
            catch (UnauthorizedAccessException)
            {
                if (Program.Administrador())
                    MessageBox.Show(this, "O Windows bloqueou a gravação na pasta do jogo, mesmo como administrador. Verifique o antivírus ou se algum arquivo está aberto.", Text, MessageBoxButtons.OK, MessageBoxIcon.Error);
                else if (MessageBox.Show(this, "A pasta do jogo exige permissão de administrador. Abrir o instalador como administrador?", Text, MessageBoxButtons.YesNo, MessageBoxIcon.Question) == DialogResult.Yes)
                {
                    try
                    {
                        Process.Start(new ProcessStartInfo(Application.ExecutablePath, "--" + acao + " \"" + jogo + "\"") { Verb = "runas", UseShellExecute = true });
                        Close();
                        return;
                    }
                    catch { }
                }
            }
            catch (Exception ex)
            {
                MessageBox.Show(this, "Não foi possível concluir. Nada foi alterado.\n\n" + ex.Message, Text, MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
            Atualizar();
        }
    }

    static class Program
    {
        [DllImport("user32.dll")] static extern bool SetProcessDPIAware();

        public static bool Administrador()
        {
            return new System.Security.Principal.WindowsPrincipal(System.Security.Principal.WindowsIdentity.GetCurrent())
                .IsInRole(System.Security.Principal.WindowsBuiltInRole.Administrator);
        }

        [STAThread]
        static void Main(string[] args)
        {
            try { SetProcessDPIAware(); } catch { }
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            string acao = null, pasta = null;
            if (args.Length == 2 && (args[0] == "--install" || args[0] == "--uninstall")) { acao = args[0].Substring(2); pasta = args[1]; }
            Application.Run(new Janela(pasta, acao));
        }
    }
}
