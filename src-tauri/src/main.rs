// Sin esto, Windows abre una consola extra atrás de la ventana en release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    convoyrun_lib::run()
}
