# Benchmark screen

Future home of the desktop benchmark runner and result views. It should call the shared benchmark boundary rather than implementing evaluation logic in React.

Read `src/benchmarks/README.md` before adding UI. React owns queue controls, filters, comparison presentation, and trace selection; manifests, execution, grading, and aggregation stay in the shared benchmark domain.
