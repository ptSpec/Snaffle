import { app, Menu, type MenuItemConstructorOptions } from "electron";

export function installDesktopMenu(): void {
  const template: MenuItemConstructorOptions[] = [];

  if (process.platform === "darwin") template.push({ role: "appMenu" });

  template.push(
    process.platform === "darwin"
      ? { role: "fileMenu" }
      : {
          label: "File",
          submenu: [{ role: "quit" }],
        },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [{ role: "togglefullscreen" }],
    },
  );

  if (!app.isPackaged) {
    template.push({
      label: "Developer",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { type: "separator" },
        { role: "toggleDevTools" },
      ],
    });
  }

  template.push({ role: "windowMenu" });
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
