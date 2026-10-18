//! Run the native benchmark suite without opening the desktop window.
//!
//! Usage: `cargo run --example benchmark_app -- quick [report.json]`

use opencull_lib::benchmark::{benchmark_start, benchmark_status, RunState};
use std::{env, error::Error, fs::OpenOptions, io::Write, path::PathBuf, thread, time::Duration};

fn main() {
    if let Err(error) = run() {
        eprintln!("{error}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), Box<dyn Error>> {
    let mut args = env::args().skip(1);
    let mode = args.next().unwrap_or_else(|| "quick".to_string());
    let output = args.next().map(PathBuf::from);
    if args.next().is_some() {
        return Err("Usage: benchmark_app [quick|thorough] [report.json]".into());
    }

    let run_id = benchmark_start(mode).map_err(std::io::Error::other)?;
    let mut last_stage = String::new();
    loop {
        let status = benchmark_status();
        if status.run_id.as_deref() != Some(&run_id) {
            return Err("The benchmark worker stopped unexpectedly.".into());
        }
        if status.state != RunState::Running {
            if let Some(report) = status.report {
                let json = serde_json::to_vec_pretty(&report)?;
                if let Some(path) = &output {
                    let mut file = OpenOptions::new().write(true).create_new(true).open(path)?;
                    file.write_all(&json)?;
                    eprintln!("Wrote benchmark report to {}", path.display());
                } else {
                    println!("{}", String::from_utf8(json)?);
                }
            } else if let Some(error) = status.error {
                eprintln!("{error}");
            }
            return if status.state == RunState::Completed {
                Ok(())
            } else {
                Err(format!("Benchmark ended in {:?} state.", status.state).into())
            };
        }
        if let Some(stage) = status.current {
            if stage != last_stage {
                eprintln!("{}/{}  {stage}", status.completed, status.total);
                last_stage = stage;
            }
        }
        thread::sleep(Duration::from_millis(200));
    }
}
